// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

/**
 * Dependency-free structural checks for the preset formats this family ships.
 *
 * These are deliberately described as *sanity* checks, not conformance: they
 * catch truncation, unbalanced delimiters, stray tabs and malformed entries,
 * which is what a bad template render or a botched merge actually produces.
 * Semantic validation of a native preset is the job of the real toolchain,
 * which the `native-validate` CI job runs (rustfmt, ruff, gofmt, ...).
 */

const strip = (line) => line.trim();

function checkJson(text) {
  try {
    JSON.parse(text);
    return [];
  } catch (error) {
    return [`invalid JSON: ${error.message}`];
  }
}

function checkToml(text) {
  const problems = [];
  let line = 0;
  for (const raw of text.split("\n")) {
    line += 1;
    const s = strip(raw);
    if (s === "" || s.startsWith("#")) {
      continue;
    }
    if (/^\[\[?[^\]]+\]\]?$/.test(s)) {
      continue;
    }
    if (/^[A-Za-z0-9_."'-]+\s*=\s*\S/.test(s)) {
      continue;
    }
    // continuation of a multi-line array or string is acceptable
    if (/^[\]}"']/.test(s) || /[,[{]$/.test(s) || /^[-\d"']/.test(s)) {
      continue;
    }
    problems.push(
      `line ${line}: not a TOML comment, table or key/value: ${JSON.stringify(s.slice(0, 60))}`,
    );
  }
  const open = (text.match(/\[/g) || []).length;
  const close = (text.match(/\]/g) || []).length;
  if (open !== close) {
    problems.push(`unbalanced square brackets: ${open} open, ${close} close`);
  }
  return problems;
}

function checkYaml(text) {
  const problems = [];
  let line = 0;
  for (const raw of text.split("\n")) {
    line += 1;
    if (/^\s*\t/.test(raw)) {
      problems.push(`line ${line}: tab used for indentation (invalid in YAML)`);
    }
    if (/\s+$/.test(raw) && strip(raw) !== "") {
      problems.push(`line ${line}: trailing whitespace`);
    }
  }
  if (/^\s*$/.test(text)) {
    problems.push("file is empty");
  }
  return problems;
}

function checkXml(text) {
  const stack = [];
  const problems = [];
  const tag = /<\/?([A-Za-z_][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g;
  let match;
  while ((match = tag.exec(text)) !== null) {
    const whole = match[0];
    if (whole.startsWith("<?") || whole.startsWith("<!")) {
      continue;
    }
    if (whole.endsWith("/>")) {
      continue;
    }
    if (whole.startsWith("</")) {
      const open = stack.pop();
      if (open !== match[1]) {
        problems.push(
          `closing </${match[1]}> does not match <${open ?? "nothing"}>`,
        );
      }
    } else {
      stack.push(match[1]);
    }
  }
  if (stack.length) {
    problems.push(`unclosed element(s): ${stack.join(", ")}`);
  }
  return problems;
}

function checkIni(text) {
  const problems = [];
  let line = 0;
  for (const raw of text.split("\n")) {
    line += 1;
    const s = strip(raw);
    if (s === "" || s.startsWith("#") || s.startsWith(";")) {
      continue;
    }
    if (/^\[[^\]]+\]$/.test(s)) {
      continue;
    }
    if (/^[^=]+=/.test(s)) {
      continue;
    }
    if (/^[\w.-]+$/.test(s)) {
      continue;
    } // bare flag lines (shellcheck, shfmt)
    problems.push(
      `line ${line}: not a section, comment or key/value: ${JSON.stringify(s.slice(0, 60))}`,
    );
  }
  return problems;
}

const BY_EXT = {
  ".json": checkJson,
  ".toml": checkToml,
  ".yml": checkYaml,
  ".yaml": checkYaml,
  ".xml": checkXml,
  ".props": checkXml,
  ".neon": null,
  ".php": null,
  ".py": null,
  ".js": null,
  ".zon": null,
  ".cff": checkYaml,
};

const BY_NAME = {
  ".editorconfig": checkIni,
  ".flake8": checkIni,
  ".shellcheckrc": checkIni,
  // A flags file (`-i 2`, `-bn`), not INI. shfmt itself is the only real check.
  ".shfmt": null,
  ".lintr": null,
  ".clang-format": checkYaml,
  ".clang-tidy": checkYaml,
  ".sqlfluff": checkIni,
  ".rubocop.yml": checkYaml,
  ".golangci.yml": checkYaml,
  "staticcheck.conf": null,
  Dockerfile: null,
};

/**
 * Pick the structural checker for a preset file, or null when the format has
 * no dependency-free check worth making (the native toolchain covers it).
 * @param {string} filename
 * @returns {((text: string) => string[])|null}
 */
function checkerFor(filename) {
  const base = filename.split("/").pop();
  if (Object.prototype.hasOwnProperty.call(BY_NAME, base)) {
    return BY_NAME[base];
  }
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot) : "";
  if (Object.prototype.hasOwnProperty.call(BY_EXT, ext)) {
    return BY_EXT[ext];
  }
  return null;
}

module.exports = {
  checkerFor,
  checkJson,
  checkToml,
  checkYaml,
  checkXml,
  checkIni,
};
