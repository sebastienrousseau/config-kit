// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

/**
 * Builds a throwaway configuration package that satisfies the whole family
 * standard, so tests can break exactly one thing and prove the suite notices.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// npm reads this environment variable name verbatim; a camelCase spelling
// would simply be ignored, so it is built as a computed key.
const NPM_LOGLEVEL = "npm_config_loglevel";

const KIT_ROOT = path.resolve(__dirname, "..", "..");
const SPDX = "SPDX-License-Identifier: Apache-2.0 OR MIT";
const VERSION = "1.2.3";

const LICENSE_BODY =
  "Permission is hereby granted, free of charge, to any person obtaining a copy of this " +
  'software and associated documentation files (the "Software"), to deal in the Software ' +
  "without restriction, including without limitation the rights to use, copy, modify, merge, " +
  "publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons " +
  "to whom the Software is furnished to do so, subject to the following conditions: the above " +
  "copyright notice and this permission notice shall be included in all copies or substantial " +
  'portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n';

function baseManifest() {
  return {
    name: "@sebastienrousseau/fixture-config",
    version: VERSION,
    description:
      "Fixture configuration package used by the config-kit test suite",
    author: "Sebastien Rousseau <sebastienrousseau@users.noreply.github.com>",
    license: "Apache-2.0 OR MIT",
    homepage: "https://github.com/sebastienrousseau/fixture-config#readme",
    repository: {
      type: "git",
      url: "git+https://github.com/sebastienrousseau/fixture-config.git",
    },
    bugs: { url: "https://github.com/sebastienrousseau/fixture-config/issues" },
    keywords: ["config", "fixture", "testkit", "conformance"],
    main: "./index.cjs",
    module: "./index.mjs",
    types: "./index.d.ts",
    exports: {
      ".": {
        types: "./index.d.ts",
        import: "./index.mjs",
        require: "./index.cjs",
      },
    },
    files: [
      "index.js",
      "index.mjs",
      "index.cjs",
      "index.d.ts",
      "fixture.toml",
      "LICENSE",
      "LICENSE-APACHE",
      "LICENSE-MIT",
    ],
    sideEffects: false,
    engines: { node: ">=20.0.0" },
    publishConfig: { access: "public" },
    configKit: { shape: "object", presets: ["fixture.toml"] },
  };
}

const CONFIG_BODY =
  '{\n  name: "@sebastienrousseau/fixture-config",\n  rules: { indent: 2 },\n}';

/** Every file the standard requires, with content that passes each gate. */
function files(manifest) {
  // `up` is the relative prefix back to the repository root, so generated
  // links resolve from both root-level and docs/ files.
  const doc = (title, up) =>
    `<!-- ${SPDX} -->\n\n# ${title}\n\nThis fixture documents ${title.toLowerCase()} for the ` +
    "config-kit conformance tests. Node 20 or newer is required.\n\n" +
    `See [the README](${up || "./"}README.md).\n`;

  return {
    "package.json": JSON.stringify(manifest, null, 2) + "\n",

    "index.cjs": `// ${SPDX}\n"use strict";\n\nmodule.exports = ${CONFIG_BODY};\n`,
    "index.js": `// ${SPDX}\n"use strict";\n\nmodule.exports = require("./index.cjs");\n`,
    "index.mjs": `// ${SPDX}\n\nconst config = ${CONFIG_BODY};\n\nexport default config;\n`,
    "index.d.ts": `// ${SPDX}\n\nexport interface FixtureConfig {\n  [key: string]: unknown;\n}\n\ndeclare const config: FixtureConfig;\nexport default config;\n`,

    "fixture.toml": `# ${SPDX}\n\n[fixture]\nindent = 2\n`,

    "README.md":
      `<!-- ${SPDX} -->\n\n# @sebastienrousseau/fixture-config\n\nFixture package. Requires Node 20 or newer.\n\n` +
      "## Documentation\n\n" +
      "- [API](./docs/API.md)\n- [Architecture](./docs/ARCHITECTURE.md)\n- [Packaging](./docs/packaging.md)\n" +
      "- [Development](./DEVELOPMENT.md)\n\n## License\n\nApache-2.0 OR MIT. See [LICENSE](./LICENSE).\n",

    "CHANGELOG.md": `<!-- ${SPDX} -->\n\n# Changelog\n\n## [Unreleased]\n\n## [${manifest.version}] - 2026-09-10\n\n### Added\n\n- Initial fixture.\n`,

    "DEVELOPMENT.md": doc("Development"),
    "AGENTS.md": doc("Agent invariants"),
    "CITATION.cff": `# ${SPDX}\ncff-version: 1.2.0\nmessage: Cite this fixture.\ntitle: fixture-config\n`,
    "CODE_OF_CONDUCT.md": doc("Code of conduct"),
    "CONTRIBUTING.md": doc("Contributing"),
    "GOVERNANCE.md": doc("Governance"),
    "SECURITY.md": doc("Security policy"),
    "SUPPORT.md": doc("Support"),
    "KEYS.asc":
      "-----BEGIN PGP PUBLIC KEY BLOCK-----\nfixture\n-----END PGP PUBLIC KEY BLOCK-----\n",
    Makefile: `# ${SPDX}\n.PHONY: test\ntest:\n\tnpm test\n`,

    LICENSE: `This project is dual-licensed under Apache-2.0 OR MIT.\nSee LICENSE-APACHE and LICENSE-MIT.\n`,
    "LICENSE-APACHE":
      "Apache License, Version 2.0\n\n" + LICENSE_BODY + LICENSE_BODY,
    "LICENSE-MIT": "MIT License\n\n" + LICENSE_BODY + LICENSE_BODY,

    "docs/README.md": doc("Documentation index", "../"),
    "docs/API.md": doc("API reference", "../"),
    "docs/ARCHITECTURE.md": doc("Architecture", "../"),
    "docs/FEATURES.md": doc("Features", "../"),
    "docs/MIGRATION.md": doc("Migration", "../"),
    "docs/packaging.md": doc("Packaging", "../"),

    ".editorconfig": "root = true\n\n[*]\nindent_style = space\n",
    ".gitattributes": "* text=auto eol=lf\n",
    ".pre-commit-config.yaml": `# ${SPDX}\nrepos: []\n`,
    ".npmignore": "tests/\n",

    ".github/CODEOWNERS": "* @sebastienrousseau\n",
    ".github/dependabot.yml": `# ${SPDX}\nversion: 2\nupdates: []\n`,
    ".github/PULL_REQUEST_TEMPLATE.md": doc("Pull request"),
    ".github/ISSUE_TEMPLATE/bug_report.yml": `# ${SPDX}\nname: Bug\ndescription: Report a bug\nbody: []\n`,
    ".github/ISSUE_TEMPLATE/feature_request.yml": `# ${SPDX}\nname: Feature\ndescription: Request a feature\nbody: []\n`,

    ".github/workflows/ci.yml": `# ${SPDX}\nname: CI\non: [push]\njobs: {}\n`,
    ".github/workflows/publish.yml": `# ${SPDX}\nname: Publish\non: [release]\njobs: {}\n`,
    ".github/workflows/docs.yml": `# ${SPDX}\nname: Docs\non: [push]\njobs: {}\n`,
    ".github/workflows/scorecard.yml": `# ${SPDX}\nname: Scorecard\non: [push]\njobs: {}\n`,
    ".github/workflows/security.yml": `# ${SPDX}\nname: Security\non: [push]\njobs: {}\n`,

    "conformance.test.js":
      `// ${SPDX}\n"use strict";\n\n` +
      'require("@sebastienrousseau/config-kit").runSuite({ root: __dirname });\n',
  };
}

/**
 * Create a conformant fixture package on disk.
 *
 * @param {{manifest?: (m: object) => void, write?: Record<string,string>, remove?: string[]}} [mutate]
 * @returns {string} the fixture root
 */
function scaffold(mutate) {
  const options = mutate || {};
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "config-kit-fixture-"));
  const manifest = baseManifest();
  if (options.manifest) {
    options.manifest(manifest);
  }

  const tree = files(manifest);
  tree["package.json"] = JSON.stringify(manifest, null, 2) + "\n";
  Object.assign(tree, options.write || {});
  for (const gone of options.remove || []) {
    delete tree[gone];
  }

  for (const [rel, content] of Object.entries(tree)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  for (const gone of options.remove || []) {
    fs.rmSync(path.join(root, gone), { force: true });
  }

  // Make the kit resolvable from inside the fixture.
  const scope = path.join(root, "node_modules", "@sebastienrousseau");
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(KIT_ROOT, path.join(scope, "config-kit"), "dir");

  return root;
}

/**
 * Run the conformance suite inside a fixture.
 * @param {string} root
 * @returns {{code: number, output: string}}
 */
function runSuiteIn(root) {
  // A child that inherits NODE_TEST_CONTEXT believes it is already reporting to
  // a parent runner and exits 0 even when assertions fail, which would make
  // every expectation below silently vacuous. Scrub the runner's own variables.
  const env = Object.assign({}, process.env, { [NPM_LOGLEVEL]: "error" });
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;

  const result = spawnSync(
    process.execPath,
    ["--test", "conformance.test.js"],
    {
      cwd: root,
      encoding: "utf8",
      env,
    },
  );
  return {
    code: result.status,
    output: String(result.stdout || "") + String(result.stderr || ""),
  };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

module.exports = { scaffold, runSuiteIn, cleanup, VERSION, SPDX };
