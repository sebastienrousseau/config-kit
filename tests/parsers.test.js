// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  checkJson,
  checkToml,
  checkYaml,
  checkXml,
  checkIni,
} = require("../lib/parsers.js");

describe("checkJson", () => {
  it("accepts valid JSON", () => {
    assert.deepEqual(checkJson('{"a":1}'), []);
    assert.deepEqual(checkJson("[]"), []);
  });

  it("rejects truncated JSON", () => {
    assert.equal(checkJson('{"a":1,').length, 1);
  });

  it("rejects trailing commas", () => {
    assert.equal(checkJson('{"a":1,}').length, 1);
  });
});

describe("checkToml", () => {
  it("accepts comments, tables, key/value pairs and multi-line arrays", () => {
    const toml = [
      "# a comment",
      "",
      "[table]",
      'name = "value"',
      "count = 3",
      "items = [",
      "  1,",
      "  2,",
      "]",
      "[[array.of.tables]]",
      'k = "v"',
    ].join("\n");
    assert.deepEqual(checkToml(toml), []);
  });

  it("rejects prose that is not TOML", () => {
    assert.equal(checkToml("this is clearly not toml").length, 1);
  });

  it("rejects unbalanced brackets", () => {
    const problems = checkToml("items = [1, 2\n");
    assert.ok(problems.some((p) => /unbalanced/.test(p)));
  });

  it("accepts an empty document", () => {
    assert.deepEqual(checkToml(""), []);
  });
});

describe("checkYaml", () => {
  it("accepts space-indented YAML", () => {
    assert.deepEqual(checkYaml("root:\n  child: 1\n"), []);
  });

  it("rejects tab indentation", () => {
    const problems = checkYaml("root:\n\tchild: 1\n");
    assert.ok(problems.some((p) => /tab used/.test(p)));
  });

  it("rejects trailing whitespace", () => {
    const problems = checkYaml("root: 1   \n");
    assert.ok(problems.some((p) => /trailing whitespace/.test(p)));
  });

  it("rejects an empty document", () => {
    assert.ok(checkYaml("   \n").some((p) => /empty/.test(p)));
  });
});

describe("checkXml", () => {
  it("accepts balanced XML with a declaration and self-closing tags", () => {
    assert.deepEqual(
      checkXml('<?xml version="1.0"?>\n<module><name/></module>'),
      [],
    );
  });

  it("rejects unclosed elements", () => {
    assert.ok(
      checkXml("<module><name>x</name>").some((p) => /unclosed/.test(p)),
    );
  });

  it("rejects mismatched closing tags", () => {
    assert.ok(checkXml("<a></b>").some((p) => /does not match/.test(p)));
  });

  it("ignores comments and processing instructions", () => {
    assert.deepEqual(checkXml("<!-- c --><?pi?><a/>"), []);
  });
});

describe("checkIni", () => {
  it("accepts sections, comments, key/value pairs and bare flags", () => {
    const ini = [
      "# comment",
      "; other comment",
      "[section]",
      "key=value",
      "enable",
    ].join("\n");
    assert.deepEqual(checkIni(ini), []);
  });

  it("rejects garbage lines", () => {
    assert.ok(checkIni("|||").length > 0);
  });
});

describe("checkerFor edge cases from the real family", () => {
  const { checkerFor } = require("../lib/parsers.js");

  it("does not treat a CLI flags file as INI", () => {
    // .shfmt holds `-i 2`, `-bn`; an INI checker rejects every line of it.
    assert.equal(checkerFor(".shfmt"), null);
    assert.equal(checkerFor(".swiftformat"), null);
  });

  it("still treats real INI-shaped files as INI", () => {
    assert.equal(typeof checkerFor(".flake8"), "function");
    assert.equal(typeof checkerFor(".shellcheckrc"), "function");
    assert.equal(typeof checkerFor(".sqlfluff"), "function");
  });

  it("declines Lua and R configuration rather than guessing", () => {
    assert.equal(checkerFor(".luacheckrc"), null);
    assert.equal(checkerFor(".lintr"), null);
  });
});
