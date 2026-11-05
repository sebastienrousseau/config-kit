// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

/**
 * Escape every character RegExp gives a meaning, so the text matches itself.
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Drop every trailing "/" from a manifest entry.
 * @param {string} entry
 * @returns {string}
 */
function trimTrailingSlashes(entry) {
  // A loop, not /\/+$/: that pattern backtracks quadratically on long runs
  // of "/" that are not at the end.
  let end = entry.length;
  while (end > 0 && entry[end - 1] === "/") {
    end -= 1;
  }
  return entry.slice(0, end);
}

/**
 * The CHANGELOG heading that documents a release.
 * @param {string} version the manifest version
 * @returns {RegExp}
 */
function versionHeading(version) {
  return new RegExp("^##\\s*\\[" + escapeRegExp(version) + "\\]", "m");
}

/**
 * Every "<name>@x.y.z" pin of a package, the version captured.
 * @param {string} name the package name
 * @returns {RegExp}
 */
function pinPattern(name) {
  return new RegExp(escapeRegExp(name) + "@(\\d+\\.\\d+\\.\\d+)", "g");
}

module.exports = {
  escapeRegExp,
  trimTrailingSlashes,
  versionHeading,
  pinPattern,
};
