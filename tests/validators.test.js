// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

/**
 * Validators are the gates that hand a configuration to its real tool, so the
 * property that matters most is that they never pass when the tool is absent.
 * These tests drive each validator with no tools installed and assert it fails
 * with a message naming what is missing.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const validators = require("../lib/validators.js");

/** Capture the tests a validator registers without executing them. */
function capture(validator, context) {
  const registered = [];
  const fakeIt = (name, fn) => registered.push({ name, fn });
  validator(Object.assign({ it: fakeIt, assert }, context));
  return registered;
}

const SAMPLE_CONFIG = {
  "eslint-flat": [{ rules: { semi: ["error", "always"] } }],
  prettier: { semi: true, singleQuote: false },
  stylelint: { extends: ["stylelint-config-standard"], rules: {} },
  commitlint: { extends: ["@commitlint/config-conventional"], rules: {} },
  markdownlint: { default: true, MD013: false },
  remark: { plugins: ["remark-gfm"] },
  browserslist: ["> 0.5%", "not dead"],
  "typescript-tsconfig": { compilerOptions: {} },
  "semantic-release": {
    branches: ["main"],
    plugins: ["@semantic-release/git"],
  },
  biome: { linter: { enabled: true } },
  oxlint: { rules: {} },
  lefthook: "pre-commit:\n  commands: {}\n",
  dockerfile: "FROM node:22-alpine\nUSER node\n",
  structural: { some: "value" },
};

const PRESETS = {
  "typescript-tsconfig": ["base.json"],
  biome: ["biome.json"],
  oxlint: [".oxlintrc.json"],
  lefthook: ["lefthook.yml"],
};

describe("validator registry", () => {
  it("every exported validator is a function", () => {
    for (const [name, fn] of Object.entries(validators)) {
      assert.equal(typeof fn, "function", name + " is not a function");
    }
  });

  it("covers every tool the family configures", () => {
    for (const expected of [
      "eslint-flat",
      "prettier",
      "stylelint",
      "commitlint",
      "markdownlint",
      "remark",
      "browserslist",
      "typescript-tsconfig",
      "semantic-release",
      "biome",
      "oxlint",
      "dockerfile",
      "structural",
    ]) {
      assert.ok(validators[expected], "missing validator: " + expected);
    }
  });
});

describe("each validator registers at least one assertion", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-validators-"));

  for (const [name, validator] of Object.entries(validators)) {
    it(name + " registers tests", () => {
      const registered = capture(validator, {
        root,
        pkg: { name: "fixture" },
        config: SAMPLE_CONFIG[name],
        kit: {
          presets: PRESETS[name] || [],
          nativeToolchain: "fixture-toolchain",
        },
      });
      assert.ok(
        registered.length > 0,
        name + " registered no tests, so it could never fail",
      );
      for (const entry of registered) {
        assert.equal(typeof entry.name, "string");
        assert.equal(typeof entry.fn, "function");
      }
    });
  }
});

describe("a validator whose tool is absent fails loudly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-absent-"));

  // These validators all need a real tool, which this empty directory lacks.
  const toolBacked = [
    "eslint-flat",
    "prettier",
    "stylelint",
    "commitlint",
    "markdownlint",
    "remark",
    "browserslist",
    "typescript-tsconfig",
    "semantic-release",
    "biome",
    "oxlint",
  ];

  for (const name of toolBacked) {
    it(name + " reports the missing tool rather than passing", async () => {
      const registered = capture(validators[name], {
        root,
        pkg: { name: "fixture" },
        config: SAMPLE_CONFIG[name],
        kit: { presets: PRESETS[name] || [] },
      });

      const failures = [];
      for (const entry of registered) {
        try {
          await entry.fn();
        } catch (error) {
          failures.push(String(error.message));
        }
      }

      assert.ok(
        failures.length > 0,
        name +
          " passed every assertion with no tool installed, so the gate is vacuous",
      );
      assert.ok(
        failures.some((message) =>
          /not installed|cannot load|does not resolve|Cannot find module/i.test(
            message,
          ),
        ),
        name + " failed for an unclear reason: " + failures.join(" | "),
      );
    });
  }
});

describe("validators that need no external tool", () => {
  it("dockerfile accepts a pinned, non-root image", async () => {
    const registered = capture(validators.dockerfile, {
      root: ".",
      pkg: {},
      config: 'FROM node:22-alpine\nUSER node\nCMD ["node"]\n',
      kit: {},
    });
    for (const entry of registered) {
      await entry.fn();
    }
  });

  it("dockerfile rejects an unpinned base image", async () => {
    const registered = capture(validators.dockerfile, {
      root: ".",
      pkg: {},
      config: "FROM node\nUSER node\n",
      kit: {},
    });
    const errors = [];
    for (const entry of registered) {
      try {
        await entry.fn();
      } catch (error) {
        errors.push(error.message);
      }
    }
    assert.ok(
      errors.some((m) => /unpinned base images/.test(m)),
      "unpinned image not flagged: " + errors.join(" | "),
    );
  });

  it("dockerfile rejects an image that runs as root", async () => {
    const registered = capture(validators.dockerfile, {
      root: ".",
      pkg: {},
      config: 'FROM node:22-alpine\nCMD ["node"]\n',
      kit: {},
    });
    const errors = [];
    for (const entry of registered) {
      try {
        await entry.fn();
      } catch (error) {
        errors.push(error.message);
      }
    }
    assert.ok(
      errors.some((m) => /run as root/.test(m)),
      "root user not flagged: " + errors.join(" | "),
    );
  });

  it("dockerfile rejects content with no FROM instruction", async () => {
    const registered = capture(validators.dockerfile, {
      root: ".",
      pkg: {},
      config: "USER node\n",
      kit: {},
    });
    const errors = [];
    for (const entry of registered) {
      try {
        await entry.fn();
      } catch (error) {
        errors.push(error.message);
      }
    }
    assert.ok(
      errors.some((m) => /no FROM instruction/.test(m)),
      "missing FROM not flagged",
    );
  });

  it("structural accepts a populated object and rejects an empty one", async () => {
    const ok = capture(validators.structural, {
      root: ".",
      pkg: {},
      config: { a: 1 },
      kit: { nativeToolchain: "x", presets: [] },
    });
    for (const entry of ok) {
      await entry.fn();
    }

    const bad = capture(validators.structural, {
      root: ".",
      pkg: {},
      config: {},
      kit: { nativeToolchain: "x", presets: [] },
    });
    const errors = [];
    for (const entry of bad) {
      try {
        await entry.fn();
      } catch (error) {
        errors.push(error.message);
      }
    }
    assert.ok(
      errors.some((m) => /empty/.test(m)),
      "empty config not flagged",
    );
  });

  it("structural requires a declared native toolchain when no JS validator exists", async () => {
    const registered = capture(validators.structural, {
      root: ".",
      pkg: {},
      config: { a: 1 },
      kit: { presets: [] },
    });
    const errors = [];
    for (const entry of registered) {
      try {
        await entry.fn();
      } catch (error) {
        errors.push(error.message);
      }
    }
    assert.ok(
      errors.some((m) => /nativeToolchain/.test(m)),
      "a missing nativeToolchain declaration was not flagged",
    );
  });

  it("structural rejects a configuration that does not survive serialisation", async () => {
    const cyclic = { a: 1 };
    cyclic.self = cyclic;
    const registered = capture(validators.structural, {
      root: ".",
      pkg: {},
      config: cyclic,
      kit: { nativeToolchain: "x", presets: [] },
    });
    const errors = [];
    for (const entry of registered) {
      try {
        await entry.fn();
      } catch (error) {
        errors.push(error.message);
      }
    }
    assert.ok(errors.length > 0, "a cyclic configuration was accepted");
  });
});
