// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

/**
 * Keys whose values name a package the consumer must be able to load.
 * Kept explicit: a broad sweep over every string in a config produces false
 * positives (rule severities, globs, reporter aliases) and a noisy gate gets
 * switched off, which is how the unresolvable-plugin bug survived in the
 * first place.
 */
const PLUGIN_KEYS = new Set([
  "extends",
  "plugins",
  "plugin",
  "preset",
  "presets",
  "parser",
  "processor",
  "parserPreset",
  "configFile",
  "shareable",
  "renderer",
]);

/** Values that look like packages but never are. */
const NOT_PACKAGES = new Set([
  "error",
  "warn",
  "off",
  "always",
  "never",
  "none",
  "auto",
  "all",
  "as-needed",
  "consistent",
  "preserve",
  "es5",
  "spec",
  "dot",
  "tap",
  "json",
  "html",
  "text",
  "lcov",
  "text-summary",
  "cobertura",
  "clover",
  "default",
  "recommended",
  "standard",
  "strict",
  "stylish",
  "compact",
  "unix",
  "verbose",
  "min",
  "list",
  "markdown",
  "yaml",
  "toml",
  "babel",
  "flow",
  "typescript",
  "css",
  "scss",
  "less",
]);

const PACKAGE_RE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.-]+)*$/;

/** Prefixes that mark a bare name as a real ecosystem package. */
const KNOWN_PREFIX =
  /^(?:@|eslint-|stylelint-|remark-|rehype-|unified-|postcss-|prettier-|commitlint-|markdownlint-|semantic-release-|mocha-|jsdoc-|knip-|biome-|oxlint-|tailwindcss-|playwright-|vitest-|babel-|typescript-)/;

/**
 * Collect package specifiers a config asks the consumer to have installed.
 *
 * @param {unknown} config the loaded configuration value
 * @param {{ignore?: string[], extra?: string[]}} [options]
 * @returns {string[]} sorted, de-duplicated specifiers
 */
function collectPackageRefs(config, options = {}) {
  const ignore = new Set(options.ignore || []);
  const found = new Set(options.extra || []);
  const seen = new Set();

  const consider = (value) => {
    if (typeof value !== "string") {
      return;
    }
    const name = value.trim();
    if (name === "" || NOT_PACKAGES.has(name)) {
      return;
    }
    if (name.startsWith(".") || name.startsWith("/") || name.includes(" ")) {
      return;
    }
    if (name.includes("*") || name.includes("!")) {
      return;
    }
    if (!PACKAGE_RE.test(name)) {
      return;
    }
    if (!KNOWN_PREFIX.test(name) && !name.includes("/")) {
      return;
    }
    found.add(name);
  };

  const walk = (node, keyPath) => {
    if (node === null || typeof node !== "object" || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        // `["plugin", {options}]` tuples: only the head names a package.
        if (PLUGIN_KEYS.has(keyPath)) {
          consider(item);
        }
        walk(item, keyPath);
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (PLUGIN_KEYS.has(key)) {
        consider(value);
        if (Array.isArray(value)) {
          for (const item of value) {
            consider(item);
            if (Array.isArray(item) && item.length) {
              consider(item[0]);
            }
          }
        }
      }
      walk(value, PLUGIN_KEYS.has(key) ? key : key);
    }
  };

  // A top-level array config (semantic-release `plugins`, browserslist queries)
  // is itself a plugin list when its entries are tuples or scoped names.
  if (Array.isArray(config)) {
    for (const item of config) {
      if (Array.isArray(item) && item.length) {
        consider(item[0]);
      } else {
        consider(item);
      }
    }
  }
  walk(config, "");

  return [...found].filter((name) => !ignore.has(name)).sort();
}

module.exports = { collectPackageRefs, PLUGIN_KEYS, NOT_PACKAGES };
