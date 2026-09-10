// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const { runtimeShape, declaredShape } = require("./shape.js");
const { collectPackageRefs } = require("./refs.js");
const { resolveRef, toolState } = require("./resolve.js");
const { checkerFor } = require("./parsers.js");
const validators = require("./validators.js");

/** Files every repository in the family must carry. */
const REQUIRED_FILES = [
  "AGENTS.md",
  "CHANGELOG.md",
  "CITATION.cff",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "DEVELOPMENT.md",
  "GOVERNANCE.md",
  "KEYS.asc",
  "LICENSE",
  "LICENSE-APACHE",
  "LICENSE-MIT",
  "Makefile",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "docs/API.md",
  "docs/ARCHITECTURE.md",
  "docs/FEATURES.md",
  "docs/MIGRATION.md",
  "docs/README.md",
  "docs/packaging.md",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/publish.yml",
  ".github/workflows/docs.yml",
  ".github/workflows/scorecard.yml",
  ".github/workflows/security.yml",
  ".editorconfig",
  ".gitattributes",
  ".pre-commit-config.yaml",
];

const LICENSE_EXPR = "Apache-2.0 OR MIT";
const SPDX_LINE = "SPDX-License-Identifier: Apache-2.0 OR MIT";

// npm reads this environment variable name verbatim; a camelCase spelling
// would simply be ignored, so it is built as a computed key.
const NPM_LOGLEVEL = "npm_config_loglevel";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const exists = (file) => fs.existsSync(file);

/**
 * Expand a package.json `files` entry to decide whether it covers a path.
 * Only the forms this family uses are handled: literal paths, directories,
 * and single-segment globs.
 *
 * @param {string[]} filesArray the manifest's files allowlist
 * @param {string} target repo-relative path
 * @returns {boolean}
 */
function coversPath(filesArray, target) {
  return filesArray.some((entry) => {
    // Normalise both the "./x" and "dir/" forms npm accepts.
    const clean = entry.replace(/^\.\//, "").replace(/\/+$/, "");
    if (clean === "") {
      return false;
    }
    if (clean === target) {
      return true;
    }
    if (target.startsWith(clean + "/")) {
      return true;
    }
    if (clean.includes("*")) {
      // Translated in one pass. An earlier version parked `**` on a sentinel
      // character while `*` was rewritten, and that sentinel ended up in the
      // file as a literal NUL — enough for grep and file(1) to call this
      // source binary, and enough to break the SPDX gate in CI.
      const source = clean
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*|\*/g, (match) => (match === "**" ? ".*" : "[^/]*"));
      return new RegExp("^" + source + "$").test(target);
    }
    return false;
  });
}

/**
 * Every file the published tarball would contain, according to npm itself.
 * @param {string} root package root
 * @returns {string[]}
 */
function packedFiles(root) {
  // On Windows npm is a .cmd shim, and since the CVE-2024-27980 mitigation
  // Node refuses to execFile a .cmd directly — it fails with EINVAL. Running it
  // through the shell is the supported way. The arguments here are fixed
  // literals, so there is nothing for the shell to reinterpret.
  const windows = process.platform === "win32";
  const npm = windows ? "npm.cmd" : "npm";
  const out = execFileSync(npm, ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: windows,
    env: Object.assign({}, process.env, { [NPM_LOGLEVEL]: "error" }),
  });
  const parsed = JSON.parse(out);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return entry && entry.files ? entry.files.map((f) => f.path) : [];
}

/**
 * Relative markdown link targets, excluding anchors, URLs and mailto.
 * @param {string} markdown
 * @returns {string[]}
 */
function localLinks(markdown) {
  const links = [];
  const re = /\]\(\s*(?!https?:|mailto:|#)([^)\s#]+)(?:#[^)\s]*)?\s*\)/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    links.push(m[1]);
  }
  return links;
}

/** Collect every string target in a package.json exports map. */
function exportTargets(exportsMap) {
  const targets = [];
  const walk = (node) => {
    if (typeof node === "string") {
      targets.push(node.replace(/^\.\//, ""));
      return;
    }
    if (node && typeof node === "object") {
      for (const value of Object.values(node)) {
        walk(value);
      }
    }
  };
  walk(exportsMap);
  return [...new Set(targets)];
}

/**
 * Register the family conformance suite for one package.
 *
 * @param {{root?: string}} [options] package root; defaults to the cwd
 */
function runSuite(options) {
  const opts = options || {};
  const root = path.resolve(opts.root || process.cwd());
  const pkg = readJson(path.join(root, "package.json"));
  const kit = pkg.configKit || {};
  const name = pkg.name;

  const cjs = require(path.join(root, "index.cjs"));
  const rootEntry = require(path.join(root, "index.js"));
  const dts = fs.readFileSync(path.join(root, "index.d.ts"), "utf8");
  // pathToFileURL, not string concatenation: on Windows path.join yields
  // "D:\\a\\repo\\index.mjs", and "file://" + that is not a valid URL.
  const esmUrl = pathToFileURL(path.join(root, "index.mjs")).href;

  describe(name + " · entrypoints", () => {
    it("loads the CommonJS entrypoint", () => {
      assert.notEqual(cjs, null, "index.cjs exported null");
    });

    it("root index.js is an alias of the CommonJS entrypoint", () => {
      assert.deepEqual(rootEntry, cjs, "index.js and index.cjs disagree");
    });

    it("loads the ESM entrypoint with a default export", async () => {
      const esm = await import(esmUrl);
      assert.ok("default" in esm, "index.mjs has no default export");
      assert.notEqual(esm.default, null, "index.mjs default export is null");
    });

    it("CommonJS and ESM export identical configuration", async () => {
      const esm = await import(esmUrl);
      assert.deepEqual(
        esm.default,
        cjs,
        "index.mjs default export differs from index.cjs; the two entrypoints must be interchangeable",
      );
    });
  });

  describe(name + " · declared type matches runtime", () => {
    const declared = declaredShape(dts);
    const actual = runtimeShape(cjs);

    it("index.d.ts declares an analysable default export", () => {
      assert.notEqual(
        declared,
        null,
        "could not determine the shape index.d.ts promises; it must be a recognisable declaration form",
      );
    });

    it(
      "runtime export has the declared shape (" + String(declared) + ")",
      () => {
        assert.equal(
          actual,
          declared,
          'index.d.ts promises "' +
            String(declared) +
            '" but index.cjs exports "' +
            actual +
            '"; TypeScript consumers would be mistyped',
        );
      },
    );

    it("ESM default export has the same shape", async () => {
      const esm = await import(esmUrl);
      assert.equal(
        runtimeShape(esm.default),
        declared,
        "index.mjs default export shape differs from the declaration",
      );
    });

    if (kit.shape) {
      it(
        'shape matches the manifest’s configKit.shape ("' + kit.shape + '")',
        () => {
          assert.equal(actual, kit.shape);
        },
      );
    }
  });

  describe(name + " · manifest", () => {
    it("declares the family licence expression", () => {
      assert.equal(pkg.license, LICENSE_EXPR);
    });

    it("declares a concrete semver version", () => {
      assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    });

    it("declares an engines.node range", () => {
      assert.ok(
        pkg.engines &&
          typeof pkg.engines.node === "string" &&
          pkg.engines.node.length > 0,
        "engines.node is missing; the README and badges advertise a supported floor, so the manifest must state it",
      );
      assert.match(pkg.engines.node, /\d+/);
    });

    it("declares repository, bugs, homepage and author", () => {
      assert.ok(pkg.repository && pkg.repository.url, "repository.url missing");
      assert.ok(pkg.bugs && pkg.bugs.url, "bugs.url missing");
      assert.ok(pkg.homepage, "homepage missing");
      assert.ok(pkg.author, "author missing");
    });

    it("publishes publicly with a files allowlist", () => {
      assert.equal(pkg.publishConfig && pkg.publishConfig.access, "public");
      assert.ok(
        Array.isArray(pkg.files) && pkg.files.length > 0,
        "files allowlist missing",
      );
    });

    it("declares conditional exports with types for both module systems", () => {
      assert.ok(pkg.exports, "exports map missing");
      const dot = pkg.exports["."];
      assert.ok(dot, 'exports["."] missing');
      for (const condition of ["types", "import", "require"]) {
        assert.ok(dot[condition], 'exports["."].' + condition + " missing");
      }
    });

    it("is marked side-effect free", () => {
      assert.equal(
        pkg.sideEffects,
        false,
        "sideEffects:false lets bundlers drop this package when it is unused",
      );
    });

    it("carries at least four keywords for registry discovery", () => {
      assert.ok(
        Array.isArray(pkg.keywords) && pkg.keywords.length >= 4,
        "only " + (pkg.keywords || []).length + " keywords",
      );
    });
  });

  describe(name + " · exports map integrity", () => {
    for (const target of exportTargets(pkg.exports)) {
      it("exports target exists on disk: " + target, () => {
        assert.ok(
          exists(path.join(root, target)),
          target + " is referenced by exports but absent",
        );
      });

      it("exports target is in the files allowlist: " + target, () => {
        assert.ok(
          coversPath(pkg.files, target),
          target +
            " is exported but not listed in files, so it would be missing from the tarball",
        );
      });
    }
  });

  describe(name + " · shipped presets", () => {
    const presets = [...new Set(kit.presets || [])];

    if (presets.length === 0) {
      it("declares no external preset files (configuration is inline)", () => {
        assert.ok(true);
      });
    }

    for (const preset of presets) {
      it("preset ships and is in the files allowlist: " + preset, () => {
        assert.ok(
          exists(path.join(root, preset)),
          preset + " is declared in configKit.presets but absent",
        );
        assert.ok(
          coversPath(pkg.files, preset),
          preset +
            " is read at runtime but is not in files, so consumers get ENOENT",
        );
      });

      it("preset is non-empty and structurally sound: " + preset, () => {
        const text = fs.readFileSync(path.join(root, preset), "utf8");
        assert.ok(text.trim().length > 0, preset + " is empty");
        const checker = checkerFor(preset);
        if (checker) {
          const problems = checker(text);
          assert.deepEqual(problems, [], preset + ": " + problems.join("; "));
        } else {
          assert.ok(
            kit.nativeToolchain,
            preset +
              " has no dependency-free structural check, so configKit.nativeToolchain " +
              "must name the toolchain that validates it in CI",
          );
        }
      });
    }
  });

  describe(name + " · dependency resolvability", () => {
    const state = toolState(pkg, root);
    const refs = collectPackageRefs(cjs, {
      ignore: kit.resolveIgnore,
      extra: kit.resolveExtra,
    });

    it("declared tools are installed so this gate can actually run", () => {
      assert.deepEqual(
        state.missing,
        [],
        "not installed: " +
          state.missing.join(", ") +
          '; run "npm ci" before the conformance suite',
      );
    });

    if (refs.length === 0) {
      it("configuration references no external packages", () => {
        assert.ok(true);
      });
    }

    for (const ref of refs) {
      it("consumer can resolve referenced package: " + ref, () => {
        const result = resolveRef(ref, root, state.tools);
        assert.ok(
          result.ok,
          '"' +
            ref +
            '" is named by the configuration but cannot be resolved.\n  tried: ' +
            (result.tried || []).join("\n         ") +
            "\n  declare it in dependencies so consumers receive it.",
        );
      });
    }
  });

  describe(name + " · tarball", () => {
    let packed = null;
    let packError = null;
    try {
      packed = packedFiles(root);
    } catch (error) {
      packError = error;
    }

    it("npm pack succeeds", () => {
      assert.equal(
        packError,
        null,
        "npm pack failed: " + (packError && packError.message),
      );
    });

    it("tarball contains every exports target and preset", () => {
      assert.notEqual(packed, null, "pack output unavailable");
      const needed = new Set(exportTargets(pkg.exports));
      for (const preset of kit.presets || []) {
        needed.add(preset);
      }
      const missing = [...needed].filter((file) => !packed.includes(file));
      assert.deepEqual(
        missing,
        [],
        "absent from the published tarball: " + missing.join(", "),
      );
    });

    it("tarball excludes development material", () => {
      assert.notEqual(packed, null, "pack output unavailable");
      const leaked = packed.filter(
        (file) =>
          file.startsWith("tests/") ||
          file.startsWith("test/") ||
          file.startsWith("benches/") ||
          file.startsWith("fuzz/") ||
          file.startsWith("web/") ||
          file.startsWith("node_modules/") ||
          path.basename(file) === ".DS_Store",
      );
      assert.deepEqual(
        leaked,
        [],
        "development files would be published: " + leaked.join(", "),
      );
    });
  });

  describe(name + " · repository layout", () => {
    for (const file of REQUIRED_FILES) {
      it("carries " + file, () => {
        assert.ok(
          exists(path.join(root, file)),
          file + " is required by the family standard",
        );
      });
    }

    it("dual licence grant ships both full texts", () => {
      for (const file of ["LICENSE-APACHE", "LICENSE-MIT"]) {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        assert.ok(
          text.length > 500,
          file + " looks truncated (" + text.length + " bytes)",
        );
      }
    });
  });

  describe(name + " · SPDX headers", () => {
    for (const file of ["index.js", "index.cjs", "index.mjs", "index.d.ts"]) {
      it("declares its licence: " + file, () => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        assert.ok(
          text.includes(SPDX_LINE),
          file + ' has no "' + SPDX_LINE + '" header',
        );
      });
    }

    const workflowDir = path.join(root, ".github", "workflows");
    const workflows = exists(workflowDir) ? fs.readdirSync(workflowDir) : [];
    for (const file of workflows) {
      if (!/\.ya?ml$/.test(file)) {
        continue;
      }
      it("declares its licence: .github/workflows/" + file, () => {
        const text = fs.readFileSync(path.join(workflowDir, file), "utf8");
        assert.ok(
          text.includes(SPDX_LINE),
          "workflow " + file + " has no SPDX header",
        );
      });
    }

    // A single stray NUL is enough for grep and file(1) to classify a source
    // as binary. That silently breaks the licence scan in CI, and the file
    // still runs, so nothing else notices. This kit shipped exactly that bug.
    for (const file of ["index.js", "index.cjs", "index.mjs", "index.d.ts"]) {
      it("is text, not binary: " + file, () => {
        const bytes = fs.readFileSync(path.join(root, file));
        const at = bytes.indexOf(0);
        assert.equal(
          at,
          -1,
          file +
            " contains a NUL byte at offset " +
            at +
            "; tools that scan sources will treat it as binary",
        );
      });
    }
  });

  describe(name + " · version coherence", () => {
    it("CHANGELOG documents this version", () => {
      const log = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
      const heading = new RegExp(
        "^##\\s*\\[" + pkg.version.replace(/\./g, "\\.") + "\\]",
        "m",
      );
      assert.match(
        log,
        heading,
        'CHANGELOG.md has no "## [' + pkg.version + ']" heading',
      );
    });

    it("no source file hardcodes a different version", () => {
      for (const file of ["index.cjs", "index.mjs"]) {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        for (const m of text.matchAll(/version:\s*"(\d+\.\d+\.\d+)"/g)) {
          assert.equal(
            m[1],
            pkg.version,
            file +
              " hardcodes version " +
              m[1] +
              " but the manifest says " +
              pkg.version,
          );
        }
      }
    });

    it("README pins no stale version of this package", () => {
      const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
      const escaped = pkg.name.replace(/[/@\-.]/g, "\\$&");
      for (const m of readme.matchAll(
        new RegExp(escaped + "@(\\d+\\.\\d+\\.\\d+)", "g"),
      )) {
        assert.equal(
          m[1],
          pkg.version,
          "README pins " +
            pkg.name +
            "@" +
            m[1] +
            " but the manifest says " +
            pkg.version,
        );
      }
    });
  });

  describe(name + " · documentation", () => {
    const docFiles = [
      "README.md",
      "DEVELOPMENT.md",
      "docs/README.md",
      "docs/API.md",
      "docs/ARCHITECTURE.md",
      "docs/FEATURES.md",
      "docs/MIGRATION.md",
      "docs/packaging.md",
    ];

    for (const doc of docFiles) {
      it("relative links resolve: " + doc, () => {
        const full = path.join(root, doc);
        assert.ok(exists(full), doc + " is missing");
        const broken = localLinks(fs.readFileSync(full, "utf8")).filter(
          (link) => !exists(path.resolve(path.dirname(full), link)),
        );
        assert.deepEqual(
          broken,
          [],
          doc + " has broken relative links: " + broken.join(", "),
        );
      });
    }

    it("README states the Node floor that engines.node declares", () => {
      const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
      const floor = /(\d+)/.exec(pkg.engines.node);
      assert.ok(floor, "engines.node has no numeric floor");
      assert.ok(
        readme.includes(floor[1]),
        "README does not mention the Node " +
          floor[1] +
          " floor declared in engines.node",
      );
    });

    it("no unresolved template placeholders in shipped docs", () => {
      for (const doc of [
        "README.md",
        "docs/API.md",
        "docs/ARCHITECTURE.md",
        "docs/packaging.md",
      ]) {
        const text = fs.readFileSync(path.join(root, doc), "utf8");
        const hits = [
          ...text.matchAll(/\{\{[A-Z_]+\}\}|TODO:|FIXME:|XXX:|lorem ipsum/gi),
        ].map((m) => m[0]);
        assert.deepEqual(
          hits,
          [],
          doc + " contains unresolved placeholders: " + hits.join(", "),
        );
      }
    });
  });

  if (kit.validate) {
    const names = Array.isArray(kit.validate) ? kit.validate : [kit.validate];
    describe(name + " · the real tool accepts this configuration", () => {
      for (const validatorName of names) {
        const validator = validators[validatorName];
        it('validator "' + validatorName + '" exists in the kit', () => {
          assert.equal(
            typeof validator,
            "function",
            'unknown validator "' + validatorName + '"',
          );
        });
        if (typeof validator === "function") {
          validator({ it, assert, root, pkg, config: cjs, kit });
        }
      }
    });
  }
}

module.exports = {
  runSuite,
  REQUIRED_FILES,
  coversPath,
  localLinks,
  exportTargets,
};
