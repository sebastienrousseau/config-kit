// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const kit = require("../index.js");
const {
  runtimeShape,
  declaredShape,
  collectPackageRefs,
  resolveRef,
  checkerFor,
  coversPath,
  localLinks,
  exportTargets,
} = kit.internals;

describe("runtimeShape", () => {
  it("classifies the shapes the family actually ships", () => {
    assert.equal(runtimeShape([]), "array");
    assert.equal(runtimeShape(["a"]), "array");
    assert.equal(runtimeShape(""), "string");
    assert.equal(runtimeShape("text"), "string");
    assert.equal(runtimeShape({}), "object");
    assert.equal(
      runtimeShape(() => {}),
      "function",
    );
    assert.equal(runtimeShape(null), "other");
    assert.equal(runtimeShape(7), "other");
  });
});

describe("declaredShape", () => {
  it("reads an array declaration", () => {
    assert.equal(declaredShape("declare const c: string[];"), "array");
    assert.equal(declaredShape("declare const c: Linter.Config[];"), "array");
    assert.equal(declaredShape("declare const c: Array<string>;"), "array");
    assert.equal(
      declaredShape("declare const c: ReadonlyArray<string>;"),
      "array",
    );
  });

  it("reads a string declaration", () => {
    assert.equal(declaredShape("declare const c: string;"), "string");
  });

  it("reads an interface declaration as an object", () => {
    const source =
      "export interface DockerConfig { [key: string]: unknown; }\ndeclare const c: DockerConfig;";
    assert.equal(declaredShape(source), "object");
  });

  it("follows a type alias to an array", () => {
    const source = "export type Presets = string[];\ndeclare const c: Presets;";
    assert.equal(declaredShape(source), "array");
  });

  it("treats an imported non-array type as an object", () => {
    const source =
      'import type { Linter } from "eslint";\ndeclare const c: Linter.Config;';
    assert.equal(declaredShape(source), "object");
  });

  it("returns null rather than guessing when there is no declaration", () => {
    assert.equal(declaredShape("export {};"), null);
  });

  it("detects the four real mismatches this kit was written to catch", () => {
    // docker-config / lefthook-config shipped an object interface over a string.
    const objectDecl =
      "export interface C { [key: string]: unknown; }\ndeclare const c: C;";
    assert.notEqual(declaredShape(objectDecl), runtimeShape("FROM node\n"));
    // size-limit-config shipped an object interface over an array.
    assert.notEqual(
      declaredShape(objectDecl),
      runtimeShape([{ limit: "1 kB" }]),
    );
    // eslint-config shipped Linter.Config[] over a CJS object.
    assert.notEqual(
      declaredShape("declare const c: Linter.Config[];"),
      runtimeShape({ rules: {} }),
    );
    // and the matching cases must agree
    assert.equal(
      declaredShape("declare const c: string;"),
      runtimeShape("FROM node\n"),
    );
    assert.equal(
      declaredShape("declare const c: string[];"),
      runtimeShape(["chrome 120"]),
    );
  });
});

describe("collectPackageRefs", () => {
  it("finds plugins in a semantic-release pipeline, including tuples", () => {
    const config = {
      branches: ["main"],
      plugins: [
        "@semantic-release/commit-analyzer",
        "@semantic-release/changelog",
        ["@semantic-release/git", { assets: ["CHANGELOG.md"] }],
      ],
    };
    assert.deepEqual(collectPackageRefs(config), [
      "@semantic-release/changelog",
      "@semantic-release/commit-analyzer",
      "@semantic-release/git",
    ]);
  });

  it("finds a shareable config behind extends", () => {
    assert.deepEqual(
      collectPackageRefs({ extends: ["stylelint-config-standard"], rules: {} }),
      ["stylelint-config-standard"],
    );
    assert.deepEqual(
      collectPackageRefs({ extends: "@commitlint/config-conventional" }),
      ["@commitlint/config-conventional"],
    );
  });

  it("finds tool-internal plugin paths so they can be resolved against the tool", () => {
    assert.deepEqual(collectPackageRefs({ plugins: ["plugins/markdown"] }), [
      "plugins/markdown",
    ]);
  });

  it("does not mistake rule severities, globs or reporter aliases for packages", () => {
    const config = {
      rules: { semi: ["error", "always"], quotes: ["error", "double"] },
      reporter: "spec",
      exclude: ["tests/**", "node_modules"],
      ignore: ["!dist"],
    };
    assert.deepEqual(collectPackageRefs(config), []);
  });

  it("ignores queries that merely look like packages", () => {
    assert.deepEqual(
      collectPackageRefs(["> 0.5%", "last 2 versions", "not dead"]),
      [],
    );
  });

  it("honours the ignore and extra escape hatches", () => {
    const config = { extends: ["stylelint-config-standard"] };
    assert.deepEqual(
      collectPackageRefs(config, { ignore: ["stylelint-config-standard"] }),
      [],
    );
    assert.deepEqual(collectPackageRefs({}, { extra: ["some-pkg"] }), [
      "some-pkg",
    ]);
  });

  it("survives a cyclic configuration object", () => {
    const config = { rules: {} };
    config.self = config;
    assert.doesNotThrow(() => collectPackageRefs(config));
  });
});

describe("resolveRef", () => {
  it("resolves a real package from the kit's own root", () => {
    const result = resolveRef("./lib/shape.js", __dirname);
    assert.equal(
      result.ok,
      false,
      "a relative path is not a package specifier",
    );
  });

  it("reports what it tried when resolution fails", () => {
    const result = resolveRef("@definitely/not-installed-xyz", __dirname, []);
    assert.equal(result.ok, false);
    assert.ok(result.tried.length > 0, "no diagnostic trail");
  });

  it("finds a file inside an installed tool", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kit-resolve-"));
    const tool = path.join(tmp, "node_modules", "faketool");
    fs.mkdirSync(path.join(tool, "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(tool, "package.json"),
      JSON.stringify({ name: "faketool", version: "1.0.0" }),
    );
    fs.writeFileSync(
      path.join(tool, "plugins", "markdown.js"),
      "module.exports = {};\n",
    );
    const result = resolveRef("plugins/markdown", tmp, ["faketool"]);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.via, /inside faketool/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("coversPath", () => {
  it("matches literal entries and directory prefixes", () => {
    assert.equal(coversPath(["index.cjs"], "index.cjs"), true);
    assert.equal(coversPath(["lib/"], "lib/shape.js"), true);
    assert.equal(coversPath(["lib"], "lib/shape.js"), true);
    assert.equal(coversPath(["index.cjs"], "index.mjs"), false);
  });

  it("matches single-segment globs without crossing directories", () => {
    assert.equal(coversPath(["*.json"], "base.json"), true);
    assert.equal(coversPath(["*.json"], "nested/base.json"), false);
    assert.equal(coversPath(["**/*.json"], "nested/base.json"), true);
  });

  it("strips a leading ./ from manifest entries", () => {
    assert.equal(coversPath(["./index.cjs"], "index.cjs"), true);
  });
});

describe("localLinks", () => {
  it("collects relative targets and ignores URLs, mailto and anchors", () => {
    const markdown = [
      "[a](./docs/API.md)",
      "[b](../LICENSE)",
      "[c](https://example.com/x)",
      "[d](mailto:a@b.c)",
      "[e](#section)",
      "[f](docs/ARCHITECTURE.md#layout)",
    ].join("\n");
    assert.deepEqual(localLinks(markdown), [
      "./docs/API.md",
      "../LICENSE",
      "docs/ARCHITECTURE.md",
    ]);
  });
});

describe("exportTargets", () => {
  it("flattens every string target in a conditional exports map", () => {
    const map = {
      ".": {
        types: "./index.d.ts",
        import: "./index.mjs",
        require: "./index.cjs",
      },
      "./base.json": "./base.json",
    };
    assert.deepEqual(exportTargets(map).sort(), [
      "base.json",
      "index.cjs",
      "index.d.ts",
      "index.mjs",
    ]);
  });
});

describe("checkerFor", () => {
  it("selects a checker by extension and by exact filename", () => {
    assert.equal(typeof checkerFor("biome.json"), "function");
    assert.equal(typeof checkerFor("rustfmt.toml"), "function");
    assert.equal(typeof checkerFor("checkstyle.xml"), "function");
    assert.equal(typeof checkerFor("Directory.Build.props"), "function");
    assert.equal(typeof checkerFor(".shellcheckrc"), "function");
    assert.equal(typeof checkerFor(".clang-format"), "function");
  });

  it("returns null for formats with no dependency-free check", () => {
    assert.equal(checkerFor("Dockerfile"), null);
    assert.equal(checkerFor("phpstan.neon"), null);
    assert.equal(checkerFor(".lintr"), null);
    assert.equal(checkerFor("build.zig.zon"), null);
  });

  it("returns null for an unknown format rather than guessing", () => {
    assert.equal(checkerFor("mystery.qqq"), null);
  });
});

describe("kit surface", () => {
  it("exports runSuite, validators and the required-file list", () => {
    assert.equal(typeof kit.runSuite, "function");
    assert.ok(
      Array.isArray(kit.REQUIRED_FILES) && kit.REQUIRED_FILES.length > 20,
    );
    assert.equal(typeof kit.validators, "object");
  });

  it("every validator is a function", () => {
    for (const [name, fn] of Object.entries(kit.validators)) {
      assert.equal(typeof fn, "function", name + " is not a function");
    }
  });

  it("the required-file list has no duplicates", () => {
    const seen = new Set(kit.REQUIRED_FILES);
    assert.equal(seen.size, kit.REQUIRED_FILES.length);
  });
});

describe("classifyType", () => {
  const { classifyType } = require("../lib/shape.js");

  it("recognises every array spelling the family generates", () => {
    assert.equal(classifyType("string[]"), "array");
    assert.equal(classifyType("Linter.Config[]"), "array");
    assert.equal(classifyType("Array<string>"), "array");
    assert.equal(
      classifyType("ReadonlyArray<Record<string, unknown>>"),
      "array",
    );
    assert.equal(classifyType("readonly string[]"), "array");
  });

  it("recognises string and declines anything else", () => {
    assert.equal(classifyType("string"), "string");
    assert.equal(classifyType("SomeInterface"), null);
    assert.equal(classifyType("Record<string, unknown>"), null);
  });
});

describe("declaredShape via a ReadonlyArray alias", () => {
  it("follows the alias the migration writes for array-shaped packages", () => {
    const source = [
      "export type SizeLimitConfig = ReadonlyArray<Record<string, unknown>>;",
      "",
      "declare const config: SizeLimitConfig;",
      "export default config;",
    ].join("\n");
    assert.equal(declaredShape(source), "array");
  });

  it("follows the alias written for string-shaped packages", () => {
    const source = [
      "export type DockerConfig = string;",
      "",
      "declare const config: DockerConfig;",
      "export default config;",
    ].join("\n");
    assert.equal(declaredShape(source), "string");
  });
});
