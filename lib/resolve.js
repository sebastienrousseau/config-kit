// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Resolve a specifier a config asks a consumer to load.
 *
 * Two forms are legitimate and both are checked:
 *  - a package: `@semantic-release/git`, `remark-gfm`
 *  - a path *inside* the owning tool: jsdoc's `plugins/markdown`, which lives
 *    at `jsdoc/plugins/markdown.js` and is never an npm package of its own
 *
 * @param {string} name specifier from the config
 * @param {string} root package root to resolve from
 * @param {string[]} tools packages that may own a tool-internal path
 * @returns {{ok: true, via: string, path: string}|{ok: false, tried: string[]}}
 */
function resolveRef(name, root, tools = []) {
  const tried = [];
  try {
    return {
      ok: true,
      via: "package",
      path: require.resolve(name, { paths: [root] }),
    };
  } catch {
    tried.push(`package "${name}" from ${root}`);
  }

  for (const tool of tools) {
    let toolDir;
    try {
      toolDir = path.dirname(
        require.resolve(`${tool}/package.json`, { paths: [root] }),
      );
    } catch {
      tried.push(`tool "${tool}" is not installed`);
      continue;
    }
    for (const candidate of [
      name,
      `${name}.js`,
      `${name}.cjs`,
      `${name}.mjs`,
      path.join(name, "index.js"),
    ]) {
      const full = path.join(toolDir, candidate);
      if (fs.existsSync(full)) {
        return { ok: true, via: `inside ${tool}`, path: full };
      }
    }
    tried.push(`no ${name} inside ${tool}`);
  }
  return { ok: false, tried };
}

/**
 * Is a package present in the dependency tree?
 *
 * Resolution alone is not a reliable test: a package may restrict its `exports`
 * so that neither its entry point nor its `package.json` is importable from
 * outside (remark-cli does exactly this), and ESM-only packages with top-level
 * await cannot be `require`d at all. Presence on disk is what "installed"
 * actually means, so that is what this checks, walking up from the package root
 * the way Node's own resolution does.
 *
 * @param {string} name package name, possibly scoped
 * @param {string} root directory to start from
 * @returns {boolean}
 */
function isInstalled(name, root) {
  let dir = path.resolve(root);
  for (;;) {
    if (fs.existsSync(path.join(dir, "node_modules", name, "package.json"))) {
      return true;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  // Fall back to Node's resolver for anything laid out unusually.
  for (const specifier of [`${name}/package.json`, name]) {
    try {
      require.resolve(specifier, { paths: [root] });
      return true;
    } catch {
      // try the next form
    }
  }
  return false;
}

/**
 * Which of a manifest's declared tools are actually installed.
 * The resolvability gate is only meaningful with devDependencies present, so
 * the suite reports missing tools as a failure rather than skipping quietly.
 *
 * @param {object} pkg parsed package.json
 * @param {string} root package root
 * @returns {{tools: string[], missing: string[]}}
 */
function toolState(pkg, root) {
  const tools = [
    ...Object.keys(pkg.peerDependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.dependencies || {}),
  ].filter((name) => !name.startsWith("@sebastienrousseau/config-kit"));
  const missing = tools.filter((name) => !isInstalled(name, root));
  return { tools: [...new Set(tools)], missing };
}

module.exports = { resolveRef, toolState, isInstalled };
