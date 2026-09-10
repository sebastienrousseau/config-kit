// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

/**
 * Domain validators: each one hands a package's configuration to the real tool
 * and asserts the tool accepts it.
 *
 * This is the gate structural coverage cannot provide. A suite that only checks
 * "the module exports an object" passes even when the object is meaningless to
 * the tool it configures, which is how an unresolvable plugin list, a dead
 * eslintrc export, a Stylelint config full of removed rules and a Biome config
 * pinned to a superseded schema all shipped at 100% line coverage.
 *
 * Two rules hold throughout:
 *
 *  1. Every validator must be capable of failing for a real reason. A gate that
 *     cannot fail is worse than no gate, because it reads as assurance.
 *  2. A validator validates the *configuration*, not the repository. Pointing a
 *     linter at its own source tree conflates "this config is invalid" with
 *     "this file happens to violate it", so each tool runs against a trivial
 *     fixture outside the repository instead.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

/* ------------------------------------------------------------------ helpers */

/** Load a tool from the package under test, failing loudly when absent. */
function loadTool(root, name) {
  let entry;
  try {
    entry = require.resolve(name, { paths: [root] });
  } catch (error) {
    throw new Error(
      'cannot load "' +
        name +
        '" from ' +
        root +
        " — add it to devDependencies so this " +
        "validation gate can run (" +
        error.code +
        ")",
    );
  }
  return require(entry);
}

/** Dynamically import a tool, for packages that are ESM or use top-level await. */
async function importTool(root, name) {
  let entry;
  try {
    entry = require.resolve(name, { paths: [root] });
  } catch (error) {
    throw new Error(
      'cannot load "' +
        name +
        '" from ' +
        root +
        " — add it to devDependencies so this " +
        "validation gate can run (" +
        error.code +
        ")",
    );
  }
  return import(require("node:url").pathToFileURL(entry).href);
}

/**
 * Path to a tool's CLI inside the package under test.
 *
 * npm writes a `.cmd` shim alongside the shell script on Windows, and
 * execFileSync does not apply PATHEXT, so the extension has to be explicit.
 */
const binPath = (root, name) =>
  path.join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? name + ".cmd" : name,
  );

/**
 * A throwaway directory holding one trivially clean source file, used as the
 * subject for CLI-based tools so repository content cannot affect the verdict.
 */
function cleanFixture(filename, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "config-kit-subject-"));
  const file = path.join(dir, filename);
  fs.writeFileSync(file, contents);
  return { dir, file };
}

/** Run a command, returning status and combined output instead of throwing. */
function run(command, argv, options) {
  const opts = options || {};
  try {
    const stdout = execFileSync(
      command,
      argv,
      Object.assign(
        {
          encoding: "utf8",
          // stdin must stay open when the caller supplies input, otherwise the
          // child reads nothing and fails for the wrong reason.
          stdio: ["input" in opts ? "pipe" : "ignore", "pipe", "pipe"],
          // node_modules/.bin entries are .cmd shims on Windows, which Node
          // refuses to execFile directly since the CVE-2024-27980 mitigation.
          shell: process.platform === "win32",
        },
        opts,
      ),
    );
    return { code: 0, output: String(stdout || "") };
  } catch (error) {
    return {
      code: typeof error.status === "number" ? error.status : 1,
      output:
        String(error.stdout || "") +
        String(error.stderr || "") +
        String(error.message || ""),
    };
  }
}

/* ------------------------------------------------------------------ ESLint */

function eslintFlat(ctx) {
  const { it, assert, root, config } = ctx;

  it("ESLint accepts the configuration and reports no errors on clean code", async () => {
    const { ESLint } = loadTool(root, "eslint");
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: config,
    });
    const results = await eslint.lintText(
      "const answer = 1;\nexport default answer;\n",
      {
        filePath: path.join(root, "fixture.js"),
      },
    );
    const errors = results
      .flatMap((r) => r.messages)
      .filter((m) => m.severity === 2)
      .map((m) => m.ruleId + ": " + m.message);
    assert.deepEqual(
      errors,
      [],
      "clean source produced errors under this configuration",
    );
  });

  it("ESLint enforces the configuration on non-conforming code", async () => {
    const { ESLint } = loadTool(root, "eslint");
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: config,
    });
    // Deliberately violates correctness rules rather than formatting ones:
    // ESLint deprecated its layout rules and moved them to @stylistic, so a
    // fixture that relies on `semi` or `indent` stops proving anything the day
    // a config drops them. `==` and a brace-less `if` are ESLint's own job.
    const results = await eslint.lintText(
      "const answer = 1;\nif (answer == 1) answer.toFixed();\nexport default answer;\n",
      {
        filePath: path.join(root, "fixture.js"),
      },
    );
    const ruleIds = results.flatMap((r) => r.messages).map((m) => m.ruleId);
    assert.ok(
      ruleIds.length > 0,
      "loose equality and a brace-less if produced no findings at all, so the " +
        "configuration enforces nothing",
    );
  });

  it("every rule the configuration sets still exists and is not deprecated", async () => {
    const eslintPath = require.resolve("eslint/use-at-your-own-risk", {
      paths: [root],
    });
    const { builtinRules } = await import(
      require("node:url").pathToFileURL(eslintPath).href
    );
    const blocks = Array.isArray(config) ? config : [config];
    const missing = [];
    const deprecated = [];
    for (const block of blocks) {
      for (const ruleId of Object.keys((block && block.rules) || {})) {
        // A plugin rule, not a core one; this check only covers core rules.
        if (ruleId.includes("/")) {
          continue;
        }
        const rule = builtinRules.get(ruleId);
        if (!rule) {
          missing.push(ruleId);
        } else if (rule.meta && rule.meta.deprecated) {
          deprecated.push(ruleId);
        }
      }
    }
    assert.deepEqual(
      missing,
      [],
      "rules this ESLint does not have: " + missing.join(", "),
    );
    assert.deepEqual(
      deprecated,
      [],
      "deprecated rules, which ESLint will remove: " +
        deprecated.join(", ") +
        ". Formatting belongs to Prettier.",
    );
  });
}

/* ---------------------------------------------------------------- Prettier */

function prettier(ctx) {
  const { it, assert, root, config } = ctx;

  it("Prettier accepts the configuration and formats with it", async () => {
    const tool = loadTool(root, "prettier");
    const formatted = await tool.format(
      "const   x={a:1,b:2}\n",
      Object.assign({}, config, { parser: "babel" }),
    );
    assert.ok(formatted.length > 0, "Prettier returned empty output");
    if (config.semi !== false) {
      assert.match(
        formatted,
        /;\s*$/,
        "semi was configured but the output has no semicolon",
      );
    }
  });

  it("formatting is idempotent under this configuration", async () => {
    const tool = loadTool(root, "prettier");
    const once = await tool.format(
      "const x = {a: 1};\n",
      Object.assign({}, config, { parser: "babel" }),
    );
    const twice = await tool.format(
      once,
      Object.assign({}, config, { parser: "babel" }),
    );
    assert.equal(
      twice,
      once,
      "re-formatting changed the output, so the configuration is unstable",
    );
  });

  it("every configured option is known to Prettier", async () => {
    const tool = loadTool(root, "prettier");
    const info = await tool.getSupportInfo();
    const known = new Set((info.options || []).map((option) => option.name));
    // $schema is metadata for editors, not a Prettier option.
    const unknown = Object.keys(config).filter(
      (key) => key !== "$schema" && !known.has(key),
    );
    assert.deepEqual(
      unknown,
      [],
      "unknown Prettier options: " + unknown.join(", "),
    );
  });
}

/* --------------------------------------------------------------- Stylelint */

function stylelint(ctx) {
  const { it, assert, root, config } = ctx;

  const lintClean = async () => {
    const tool = loadTool(root, "stylelint");
    return tool.lint({ code: "a {\n  color: #fff;\n}\n", config, cwd: root });
  };

  it("every configured rule exists in this Stylelint version", async () => {
    const result = await lintClean();
    const unknown = result.results
      .flatMap((r) => r.warnings)
      .filter((w) => /^Unknown rule/.test(w.text))
      .map((w) => w.rule);
    assert.deepEqual(
      [...new Set(unknown)],
      [],
      "the configuration names rules this Stylelint does not have, so every consumer " +
        "would see these as errors on every file",
    );
  });

  it("Stylelint accepts the configuration on conforming CSS", async () => {
    const result = await lintClean();
    const errors = result.results
      .flatMap((r) => r.warnings)
      .filter((w) => w.severity === "error")
      .map((w) => w.rule + ": " + w.text);
    assert.deepEqual(errors, [], "valid CSS was rejected");
  });

  it("Stylelint enforces the configuration on non-conforming CSS", async () => {
    const tool = loadTool(root, "stylelint");
    const result = await tool.lint({
      code: "a{color:#FFFFFF}\n",
      config,
      cwd: root,
    });
    const warnings = result.results.flatMap((r) => r.warnings);
    assert.ok(
      warnings.length > 0,
      "sloppy CSS produced no warnings, so the rules are not in force",
    );
  });
}

/* -------------------------------------------------------------- commitlint */

function commitlint(ctx) {
  const { it, assert, root, config } = ctx;
  const bin = binPath(root, "commitlint");

  const lint = (message) =>
    run(bin, ["--config", path.join(root, "index.cjs")], {
      cwd: root,
      input: message,
    });

  it("commitlint CLI is installed so this gate can run", () => {
    assert.ok(
      fs.existsSync(bin),
      "commitlint is not installed; add it to devDependencies",
    );
  });

  it("commitlint accepts a conventional commit message", () => {
    assert.ok(fs.existsSync(bin), "commitlint is not installed");
    const result = lint("feat(core): add a thing\n");
    assert.equal(
      result.code,
      0,
      "a valid conventional commit was rejected: " + result.output,
    );
  });

  it("commitlint rejects a non-conventional commit message", () => {
    assert.ok(fs.existsSync(bin), "commitlint is not installed");
    const result = lint(
      "rambling message with no type that also runs well past any sane header limit\n",
    );
    assert.notEqual(
      result.code,
      0,
      "an invalid commit message was accepted, so the rules are not in force",
    );
  });

  it("extends a resolvable shareable configuration", () => {
    for (const ref of [].concat(config.extends || [])) {
      assert.ok(
        require.resolve(ref, { paths: [root] }),
        ref + " does not resolve",
      );
    }
  });
}

/* ------------------------------------------------------------ markdownlint */

function markdownlint(ctx) {
  const { it, assert, root, config } = ctx;

  // markdownlint ships ESM-only subpath exports; the sync API lives at
  // markdownlint/sync and must be imported, not required.
  const sync = () => importTool(root, "markdownlint/sync");

  it("markdownlint accepts the configuration on conforming Markdown", async () => {
    const { lint } = await sync();
    const result = lint({
      strings: { fixture: "# Title\n\nBody text.\n" },
      config,
    });
    assert.deepEqual(
      result.fixture,
      [],
      "conforming Markdown produced findings: " +
        JSON.stringify(result.fixture),
    );
  });

  it("markdownlint enforces the configuration on non-conforming Markdown", async () => {
    const { lint } = await sync();
    const result = lint({
      strings: { fixture: "#Title\n#  Another\n" },
      config,
    });
    assert.ok(
      (result.fixture || []).length > 0,
      "malformed Markdown produced no findings, so the rules are not in force",
    );
  });

  it("every configured rule is known to markdownlint", async () => {
    const { lint } = await sync();
    // An unknown rule name makes markdownlint throw, so a clean run over a
    // trivial document is itself the check.
    assert.doesNotThrow(() => lint({ strings: { fixture: "# T\n" }, config }));
  });
}

/* ------------------------------------------------------------------ remark */

function remark(ctx) {
  const { it, assert, root, config } = ctx;
  const refs = (config.plugins || []).map((entry) =>
    Array.isArray(entry) ? entry[0] : entry,
  );

  it("declares at least one remark plugin", () => {
    assert.ok(refs.length > 0, "no plugins configured");
  });

  for (const ref of refs) {
    it(
      "plugin loads and is a valid unified attacher or preset: " + ref,
      async () => {
        const module = await importTool(root, ref);
        const attacher =
          module && "default" in module ? module.default : module;
        const valid =
          typeof attacher === "function" ||
          Array.isArray(attacher) ||
          (attacher &&
            typeof attacher === "object" &&
            Array.isArray(attacher.plugins));
        assert.ok(valid, ref + " does not export a unified plugin or preset");
      },
    );
  }
}

/* ------------------------------------------------------------ browserslist */

function browserslist(ctx) {
  const { it, assert, root, config } = ctx;
  const queries = Array.isArray(config) ? config : [config];

  it("browserslist resolves the query list to at least one browser", () => {
    const tool = loadTool(root, "browserslist");
    const resolved = tool(queries);
    assert.ok(
      Array.isArray(resolved) && resolved.length > 0,
      "the query list matched no browsers",
    );
  });

  it("the query list starts from a positive selector", () => {
    // browserslist rejects a list that only subtracts ("not dead" alone is an
    // error), so order matters and the first entry must add browsers.
    assert.ok(queries.length > 0, "no queries configured");
    assert.ok(
      !/^\s*not\s/i.test(String(queries[0])),
      'the first query is a negation ("' +
        queries[0] +
        '"), which browserslist rejects',
    );
  });

  it("browserslist rejects an unknown query, proving this gate is live", () => {
    const tool = loadTool(root, "browserslist");
    assert.throws(() => tool(["definitely not a real query"]));
  });
}

/* -------------------------------------------------------------- TypeScript */

function typescriptTsconfig(ctx) {
  const { it, assert, root, kit } = ctx;
  const presets = kit.presets || [];
  const tsc = binPath(root, "tsc");

  it("the TypeScript compiler is installed so this gate can run", () => {
    assert.ok(
      fs.existsSync(tsc),
      "typescript is not installed; add it to devDependencies",
    );
  });

  for (const preset of presets) {
    it("TypeScript compiles a project extending " + preset, () => {
      assert.ok(fs.existsSync(tsc), "typescript is not installed");
      // A real project that extends the preset: the compiler API moved in
      // TypeScript 7, but `tsc -p` behaves the same across 5, 6 and 7, and it
      // reports unknown compiler options as errors (TS5023) where
      // `--showConfig` silently drops them.
      const subject = fs.mkdtempSync(
        path.join(os.tmpdir(), "config-kit-tsconfig-"),
      );
      fs.mkdirSync(path.join(subject, "src"));
      fs.writeFileSync(
        path.join(subject, "src", "probe.ts"),
        "export const answer: number = 1;\n",
      );
      fs.writeFileSync(
        path.join(subject, "tsconfig.json"),
        JSON.stringify(
          { extends: path.join(root, preset), include: ["src"] },
          null,
          2,
        ) + "\n",
      );

      const result = run(tsc, ["-p", "tsconfig.json", "--noEmit"], {
        cwd: subject,
      });
      fs.rmSync(subject, { recursive: true, force: true });
      assert.equal(
        result.code,
        0,
        "tsc rejected a project extending " +
          preset +
          ":\n" +
          result.output.slice(0, 1200),
      );
    });
  }

  it("tsc rejects an unknown compiler option, proving this gate is live", () => {
    assert.ok(fs.existsSync(tsc), "typescript is not installed");
    const subject = fs.mkdtempSync(
      path.join(os.tmpdir(), "config-kit-tsconfig-neg-"),
    );
    fs.mkdirSync(path.join(subject, "src"));
    fs.writeFileSync(
      path.join(subject, "src", "probe.ts"),
      "export const answer: number = 1;\n",
    );
    fs.writeFileSync(
      path.join(subject, "tsconfig.json"),
      '{ "compilerOptions": { "definitelyNotAnOption": true }, "include": ["src"] }\n',
    );
    const result = run(tsc, ["-p", "tsconfig.json", "--noEmit"], {
      cwd: subject,
    });
    fs.rmSync(subject, { recursive: true, force: true });
    assert.notEqual(
      result.code,
      0,
      "tsc accepted an unknown compiler option, so this gate cannot fail",
    );
  });
}

/* -------------------------------------------------------- semantic-release */

function semanticRelease(ctx) {
  const { it, assert, root, config } = ctx;
  const plugins = (config.plugins || []).map((entry) =>
    Array.isArray(entry) ? entry[0] : entry,
  );

  const HOOKS = [
    "verifyConditions",
    "analyzeCommits",
    "generateNotes",
    "prepare",
    "publish",
    "addChannel",
    "success",
    "fail",
    "verifyRelease",
  ];

  it("declares a plugin pipeline", () => {
    assert.ok(plugins.length > 0, "no plugins configured");
  });

  it("declares release branches", () => {
    assert.ok(
      Array.isArray(config.branches) && config.branches.length > 0,
      "no release branches configured",
    );
  });

  for (const name of plugins) {
    it(
      "plugin is installable by a consumer and exposes lifecycle hooks: " +
        name,
      async () => {
        // Several of these packages are ESM with top-level await, so require()
        // cannot load them.
        const module = await importTool(root, name);
        const candidates = [module, module && module.default].filter(Boolean);
        const present = HOOKS.filter((hook) =>
          candidates.some((c) => typeof c[hook] === "function"),
        );
        assert.ok(
          present.length > 0,
          name +
            " resolves but exposes no semantic-release lifecycle hook, so it is not a valid plugin",
        );
      },
    );
  }
}

/* ------------------------------------------- CLI tools validated in isolation */

/**
 * Build a validator that runs a tool's CLI against its own config file and a
 * trivially clean subject file placed outside the repository.
 *
 * @param {string} binName binary inside node_modules/.bin
 * @param {(configPath: string, subject: string) => string[]} argv
 * @param {{filename: string, contents: string}} fixture
 */
function cliConfigCheck(binName, argv, fixture) {
  return function validator(ctx) {
    const { it, assert, root, kit } = ctx;
    const bin = binPath(root, binName);

    it(binName + " CLI is installed so this gate can run", () => {
      assert.ok(
        fs.existsSync(bin),
        binName + " is not installed; add it to devDependencies",
      );
    });

    for (const preset of kit.presets || []) {
      it(binName + " accepts " + preset + " against a clean subject", () => {
        assert.ok(fs.existsSync(bin), binName + " is not installed");
        const subject = cleanFixture(fixture.filename, fixture.contents);
        const result = run(bin, argv(path.join(root, preset), subject.file), {
          cwd: root,
        });
        fs.rmSync(subject.dir, { recursive: true, force: true });
        assert.equal(
          result.code,
          0,
          binName +
            " rejected " +
            preset +
            ":\n" +
            result.output.slice(0, 1500),
        );
      });
    }
  };
}

/* ----------------------------------------------------- structural fallback */

/**
 * For tools with no JavaScript validation entry point. Named explicitly so a
 * weaker tier is never mistaken for a strong one: the real validation for these
 * packages is the native-validate CI job, which `configKit.nativeToolchain`
 * must name.
 */
function structuralOnly(ctx) {
  const { it, assert, root, config, kit } = ctx;

  it("configuration is a non-empty value of its declared shape", () => {
    if (typeof config === "string") {
      assert.ok(config.trim().length > 0, "configuration string is empty");
    } else if (Array.isArray(config)) {
      assert.ok(config.length > 0, "configuration array is empty");
    } else {
      assert.ok(
        Object.keys(config).length > 0,
        "configuration object is empty",
      );
    }
  });

  it("configuration round-trips through JSON without loss", () => {
    if (typeof config === "string") {
      return;
    }
    assert.deepEqual(
      JSON.parse(JSON.stringify(config)),
      config,
      "configuration contains values that do not survive serialisation",
    );
  });

  it("names the toolchain that validates it in CI", () => {
    assert.ok(
      kit.nativeToolchain,
      "no JavaScript validator exists for this tool, so configKit.nativeToolchain must name " +
        "the toolchain the native-validate CI job runs",
    );
  });

  for (const preset of kit.presets || []) {
    it("preset is present for the CI toolchain to validate: " + preset, () => {
      assert.ok(fs.existsSync(path.join(root, preset)), preset + " is missing");
    });
  }
}

/* ---------------------------------------------------------------- Dockerfile */

function dockerfile(ctx) {
  const { it, assert, config } = ctx;
  const text =
    typeof config === "string"
      ? config
      : String((config && config.content) || "");

  it("Dockerfile declares a FROM instruction", () => {
    assert.match(text, /^\s*FROM\s+\S+/m, "no FROM instruction found");
  });

  it("every base image is pinned by digest or explicit tag", () => {
    const froms = [...text.matchAll(/^\s*FROM\s+(\S+)/gm)].map((m) => m[1]);
    const unpinned = froms.filter(
      (ref) =>
        !ref.includes("@sha256:") && !ref.includes(":") && !ref.startsWith("$"),
    );
    assert.deepEqual(
      unpinned,
      [],
      "unpinned base images (Scorecard flags these): " + unpinned.join(", "),
    );
  });

  it("does not run as root by default", () => {
    assert.match(
      text,
      /^\s*USER\s+/m,
      "no USER instruction; the image would run as root",
    );
  });
}

const JS_SUBJECT = {
  filename: "subject.js",
  contents: "export const answer = 1;\n",
};

// There is deliberately no `lefthook` validator. Its npm wrapper does not accept
// a --config flag, and `lefthook validate` exits 0 even for a malformed config,
// so any gate built on it could not fail. lefthook-config therefore uses the
// structural validator and names lefthook as its CI toolchain instead.

module.exports = {
  "eslint-flat": eslintFlat,
  prettier,
  stylelint,
  commitlint,
  markdownlint,
  remark,
  browserslist,
  "typescript-tsconfig": typescriptTsconfig,
  "semantic-release": semanticRelease,
  biome: cliConfigCheck(
    "biome",
    (configPath, subject) => ["check", "--config-path=" + configPath, subject],
    JS_SUBJECT,
  ),
  oxlint: cliConfigCheck(
    "oxlint",
    (configPath, subject) => ["--config", configPath, subject],
    JS_SUBJECT,
  ),
  dockerfile,
  structural: structuralOnly,
};
