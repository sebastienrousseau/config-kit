<!-- SPDX-License-Identifier: Apache-2.0 OR MIT -->

# Agent invariants

Rules for AI-assisted contributions to this repository.

- **Never weaken a gate to make a repository pass.** If a consuming package
  fails a check, the package is wrong until proven otherwise. Investigate the
  package first; change the kit only when the check itself is demonstrably
  incorrect, and add a test pinning the corrected behaviour.
- **Every new gate needs a failing test first.** `tests/integration.test.js`
  breaks one thing per case and asserts the suite fails naming the problem. A
  gate that has never been seen to fail is not a gate.
- **No silent skips.** No `return` that bypasses an assertion, no condition
  chain without a final branch, no try/catch that swallows. If a check cannot
  run, it fails and says why. A chain with no `else` is exactly how the defect
  this package exists to prevent stayed hidden.
- **Do not raise the coverage threshold by adding tests that assert nothing.**
  The policy and its rationale are in DEVELOPMENT.md.
- **Versioning.** This package moves in lockstep with the configuration family.
  A new gate is a minor bump, because it will fail repositories that do not yet
  satisfy it.
- **Signing.** Tags are signed. Never rewrite a pushed tag.
