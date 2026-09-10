<!-- SPDX-License-Identifier: Apache-2.0 OR MIT -->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.8] - 2026-09-10

### Fixed

- Windows: `npm pack` and the `node_modules/.bin` tools are now spawned through
  the shell. Since the CVE-2024-27980 mitigation Node refuses to `execFile` a
  `.cmd` shim directly, so every Windows job failed with
  `spawnSync npm.cmd EINVAL` and took three tarball assertions down with it.
  Appending `.cmd` was not enough; `shell: true` is the supported form.
- Windows: the ESM entrypoint URL is built with `pathToFileURL` rather than
  string concatenation. `"file://" + "D:\\a\\repo\\index.mjs"` is not a
  valid URL.


## [0.0.7] - 2026-09-10

### Added

- Initial release. Extracted from the per-repository suites it replaces, and
  versioned with the rest of the family.
- `runSuite`: packaging, declared-type, resolvability, tarball, layout, SPDX,
  version-coherence and documentation gates.
- Validators for ESLint, Prettier, Stylelint, commitlint, markdownlint, remark,
  Browserslist, TypeScript, semantic-release, Biome, oxlint and Dockerfiles,
  plus a structural fallback that requires a named CI toolchain.
- End-to-end tests that take a conformant package, break one thing, and assert
  the suite fails naming the problem — one per defect found in the 0.0.7 audit.
