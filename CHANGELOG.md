<!-- SPDX-License-Identifier: Apache-2.0 OR MIT -->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
