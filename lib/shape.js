// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

/**
 * Classify a runtime value into the coarse shape vocabulary the family uses.
 * @param {unknown} value
 * @returns {"array"|"string"|"object"|"function"|"other"}
 */
function runtimeShape(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "function") {
    return "function";
  }
  if (value !== null && typeof value === "object") {
    return "object";
  }
  return "other";
}

/**
 * Classify a TypeScript type expression into the same vocabulary.
 * Used for both a direct declaration and the right-hand side of a type alias,
 * so the two paths can never disagree.
 *
 * @param {string} type a type expression, already trimmed
 * @returns {"array"|"string"|"object"|null} null when it names something else
 */
function classifyType(type) {
  if (/\[\s*\]$/.test(type)) {
    return "array";
  }
  if (/^(?:Readonly)?Array\s*</.test(type)) {
    return "array";
  }
  if (/^readonly\s/.test(type)) {
    return "array";
  }
  if (/^string$/.test(type)) {
    return "string";
  }
  return null;
}

/**
 * Infer the shape a `.d.ts` actually promises for its default export.
 *
 * Deliberately narrow: it understands the declaration forms this family uses
 * and returns `null` when it cannot be sure, rather than guessing. A `null`
 * result is reported as an un-analysable declaration, never as a pass.
 *
 * @param {string} source contents of an index.d.ts
 * @returns {"array"|"string"|"object"|null}
 */
function declaredShape(source) {
  const decl = /declare\s+const\s+\w+\s*:\s*([^;]+);/.exec(source);
  if (!decl) {
    return null;
  }
  const type = decl[1].trim();

  const direct = classifyType(type);
  if (direct) {
    return direct;
  }

  // A bare interface/type name: resolve it one level to see what it aliases.
  const named = /^[A-Za-z_$][\w$.]*$/.test(type) ? type.split(".").pop() : null;
  if (named) {
    const alias = new RegExp(
      "(?:type|interface)\\s+" + named + "\\b[^=\\n{]*(?:=\\s*([^;]+);|\\{)",
    ).exec(source);
    if (alias) {
      if (alias[1]) {
        return classifyType(alias[1].trim()) || "object";
      }
      return "object"; // `interface X { ... }`
    }
    // Imported from elsewhere (e.g. eslint's Linter.Config) and not an array.
    return "object";
  }
  return null;
}

module.exports = { runtimeShape, declaredShape, classifyType };
