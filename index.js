// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

"use strict";

const {
  runSuite,
  REQUIRED_FILES,
  coversPath,
  localLinks,
  exportTargets,
} = require("./lib/suite.js");
const { runtimeShape, declaredShape } = require("./lib/shape.js");
const { collectPackageRefs } = require("./lib/refs.js");
const { resolveRef, toolState } = require("./lib/resolve.js");
const { checkerFor } = require("./lib/parsers.js");
const validators = require("./lib/validators.js");

module.exports = {
  runSuite,
  validators,
  REQUIRED_FILES,
  // Exposed for the kit's own tests and for one-off diagnostics.
  internals: {
    runtimeShape,
    declaredShape,
    collectPackageRefs,
    resolveRef,
    toolState,
    checkerFor,
    coversPath,
    localLinks,
    exportTargets,
  },
};
