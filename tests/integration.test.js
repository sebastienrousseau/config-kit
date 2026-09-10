// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

/**
 * End-to-end tests for the conformance suite.
 *
 * Each case takes a package that passes every gate, breaks exactly one thing,
 * and asserts the suite fails with a message that names the problem. Every
 * defect below is one that really shipped in the configuration family while a
 * 100%-coverage suite reported green, which is the whole reason this kit exists.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { scaffold, runSuiteIn, cleanup, SPDX } = require("./helpers/fixture.js");

/** Run the suite over a mutated fixture and return its result. */
function attempt(mutation) {
  const root = scaffold(mutation);
  try {
    return runSuiteIn(root);
  } finally {
    cleanup(root);
  }
}

/** Assert the suite rejected the package, citing `needle`. */
function expectRejected(mutation, needle) {
  const { code, output } = attempt(mutation);
  assert.notEqual(
    code,
    0,
    "the suite passed a package it should have rejected",
  );
  assert.ok(
    output.includes(needle),
    'expected a failure mentioning "' +
      needle +
      '". Got:\n' +
      output.slice(-2500),
  );
}

describe("a fully conformant package", () => {
  it("passes every gate", () => {
    const { code, output } = attempt();
    assert.equal(
      code,
      0,
      "conformant fixture was rejected:\n" + output.slice(-3000),
    );
  });
});

describe("declared type versus runtime shape", () => {
  it("rejects an object declaration over a string export (the docker/lefthook defect)", () => {
    expectRejected(
      {
        write: {
          "index.cjs":
            "// " +
            SPDX +
            '\n"use strict";\n\nmodule.exports = "FROM node:22\\nUSER app\\n";\n',
          "index.mjs":
            "// " + SPDX + '\n\nexport default "FROM node:22\\nUSER app\\n";\n',
        },
        manifest: (m) => {
          m.configKit.shape = "string";
        },
      },
      "TypeScript consumers would be mistyped",
    );
  });

  it("rejects an object declaration over an array export (the size-limit defect)", () => {
    expectRejected(
      {
        write: {
          "index.cjs":
            "// " +
            SPDX +
            '\n"use strict";\n\nmodule.exports = [{ limit: "1 kB" }];\n',
          "index.mjs":
            "// " + SPDX + '\n\nexport default [{ limit: "1 kB" }];\n',
        },
        manifest: (m) => {
          m.configKit.shape = "array";
        },
      },
      "TypeScript consumers would be mistyped",
    );
  });

  it("rejects a declaration it cannot analyse rather than passing it", () => {
    expectRejected(
      { write: { "index.d.ts": "// " + SPDX + "\nexport {};\n" } },
      "recognisable declaration form",
    );
  });
});

describe("entrypoint parity", () => {
  it("rejects a package whose CJS and ESM exports differ (the eslint-config defect)", () => {
    expectRejected(
      {
        write: {
          "index.cjs":
            "// " +
            SPDX +
            '\n"use strict";\n\nmodule.exports = { env: { node: true } };\n',
          "index.mjs": "// " + SPDX + "\n\nexport default [{ rules: {} }];\n",
        },
      },
      "must be interchangeable",
    );
  });

  it("rejects a root index.js that is not an alias of index.cjs", () => {
    expectRejected(
      {
        write: {
          "index.js":
            "// " +
            SPDX +
            '\n"use strict";\n\nmodule.exports = { different: true };\n',
        },
      },
      "index.js and index.cjs disagree",
    );
  });
});

describe("packaging", () => {
  it("rejects a preset that is read at runtime but absent from files", () => {
    expectRejected(
      {
        manifest: (m) => {
          m.files = m.files.filter((f) => f !== "fixture.toml");
        },
      },
      "consumers get ENOENT",
    );
  });

  it("rejects an exports target missing from the files allowlist", () => {
    expectRejected(
      {
        manifest: (m) => {
          m.files = m.files.filter((f) => f !== "index.mjs");
        },
      },
      "missing from the tarball",
    );
  });

  it("rejects a tarball that would publish development material", () => {
    expectRejected(
      {
        manifest: (m) => {
          m.files.push("tests");
        },
        write: { "tests/keep.js": "// " + SPDX + "\n" },
      },
      "development files would be published",
    );
  });

  it("rejects a manifest without sideEffects:false", () => {
    expectRejected(
      {
        manifest: (m) => {
          delete m.sideEffects;
        },
      },
      "side-effect free",
    );
  });
});

describe("dependency resolvability", () => {
  it("rejects a plugin the consumer could never resolve (the semantic-release defect)", () => {
    expectRejected(
      {
        write: {
          "index.cjs":
            "// " +
            SPDX +
            '\n"use strict";\n\nmodule.exports = { plugins: ["@semantic-release/definitely-absent"] };\n',
          "index.mjs":
            "// " +
            SPDX +
            '\n\nexport default { plugins: ["@semantic-release/definitely-absent"] };\n',
        },
      },
      "cannot be resolved",
    );
  });

  it("rejects a package whose declared tool is not installed, instead of skipping the gate", () => {
    expectRejected(
      {
        manifest: (m) => {
          m.peerDependencies = { "some-absent-tool": ">=1" };
        },
      },
      "before the conformance suite",
    );
  });
});

describe("manifest", () => {
  it("rejects a missing engines.node (the family-wide documentation defect)", () => {
    expectRejected(
      {
        manifest: (m) => {
          delete m.engines;
        },
      },
      "engines.node is missing",
    );
  });

  it("rejects an exports map without a types condition", () => {
    expectRejected(
      {
        manifest: (m) => {
          delete m.exports["."].types;
        },
      },
      'exports["."].types missing',
    );
  });

  it("rejects too few keywords to be discoverable", () => {
    expectRejected(
      {
        manifest: (m) => {
          m.keywords = ["one"];
        },
      },
      "keywords",
    );
  });
});

describe("version coherence", () => {
  it("rejects a version with no CHANGELOG entry", () => {
    expectRejected(
      {
        manifest: (m) => {
          m.version = "9.9.9";
        },
        // Pin the changelog to the old version so the bump is genuinely undocumented.
        write: {
          "CHANGELOG.md":
            "<!-- " +
            SPDX +
            " -->\n\n# Changelog\n\n## [Unreleased]\n\n## [1.2.3] - 2026-09-10\n\n### Added\n\n- Initial fixture.\n",
        },
      },
      "CHANGELOG.md has no",
    );
  });

  it("rejects a version hardcoded in source that drifted from the manifest", () => {
    expectRejected(
      {
        write: {
          "index.cjs":
            "// " +
            SPDX +
            '\n"use strict";\n\nmodule.exports = { version: "0.0.1", rules: {} };\n',
          "index.mjs":
            "// " +
            SPDX +
            '\n\nexport default { version: "0.0.1", rules: {} };\n',
        },
      },
      "but the manifest says",
    );
  });
});

describe("licensing and layout", () => {
  it("rejects a source file with no SPDX header", () => {
    expectRejected(
      {
        write: {
          "index.cjs": '"use strict";\n\nmodule.exports = { rules: {} };\n',
        },
      },
      "has no",
    );
  });

  it("rejects a source file containing a NUL byte", () => {
    // Constructed at runtime so this test file stays plain text itself.
    const nul = String.fromCharCode(0);
    expectRejected(
      {
        write: {
          "index.cjs":
            "// " +
            SPDX +
            '\n"use strict";\n\n// sentinel: ' +
            nul +
            "\nmodule.exports = { rules: {} };\n",
        },
      },
      "contains a NUL byte",
    );
  });

  it("rejects a workflow with no SPDX header", () => {
    expectRejected(
      {
        write: {
          ".github/workflows/ci.yml": "name: CI\non: [push]\njobs: {}\n",
        },
      },
      "has no SPDX header",
    );
  });

  it("rejects a missing governance file", () => {
    expectRejected(
      { remove: [".github/CODEOWNERS"] },
      "required by the family standard",
    );
  });

  it("rejects a truncated licence text", () => {
    expectRejected({ write: { "LICENSE-MIT": "MIT\n" } }, "looks truncated");
  });
});

describe("documentation", () => {
  it("rejects a broken relative link", () => {
    expectRejected(
      {
        write: {
          "docs/API.md":
            "<!-- " + SPDX + " -->\n\n# API\n\nSee [gone](./nowhere.md).\n",
        },
      },
      "broken relative links",
    );
  });

  it("rejects an unresolved template placeholder", () => {
    expectRejected(
      {
        write: {
          "docs/packaging.md":
            "<!-- " + SPDX + " -->\n\n# Packaging\n\nTODO: write this.\n",
        },
      },
      "unresolved placeholders",
    );
  });

  it("rejects a README that does not state the declared Node floor", () => {
    expectRejected(
      {
        manifest: (m) => {
          m.engines.node = ">=24.0.0";
        },
      },
      "does not mention the Node 24 floor",
    );
  });
});

describe("preset integrity", () => {
  it("rejects a structurally broken preset", () => {
    expectRejected(
      {
        write: {
          "fixture.toml": "# " + SPDX + "\n\nthis is not valid toml at all\n",
        },
      },
      "not a TOML comment, table or key/value",
    );
  });

  it("rejects an empty preset", () => {
    expectRejected({ write: { "fixture.toml": "   \n" } }, "is empty");
  });

  it("rejects a preset format with no checker and no declared native toolchain", () => {
    expectRejected(
      {
        manifest: (m) => {
          m.configKit.presets = ["Dockerfile"];
          m.files.push("Dockerfile");
        },
        write: { Dockerfile: "FROM node:22\nUSER app\n" },
      },
      "configKit.nativeToolchain",
    );
  });
});
