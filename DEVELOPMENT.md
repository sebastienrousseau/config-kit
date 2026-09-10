<!-- SPDX-License-Identifier: Apache-2.0 OR MIT -->

# Development

## Setup

```sh
npm ci
```

Node 20 or newer, as declared in `engines.node`.

## Test layout

| File | Covers |
| --- | --- |
| `tests/unit.test.js` | shape analysis, reference collection, resolution, path helpers |
| `tests/parsers.test.js` | the dependency-free format checkers |
| `tests/validators.test.js` | every validator registers assertions and fails when its tool is absent |
| `tests/integration.test.js` | end-to-end: scaffold a conformant package, break one thing, expect failure |

## Running one suite

```sh
npm run test:unit
npm run test:e2e
```

## Coverage policy

The gate is 95% lines, 85% branches and 95% functions over `lib/`, excluding
`lib/validators.js`.

That exclusion is deliberate. A validator's success path only executes with the
real tool installed, which happens in the 38 consuming repositories, not here.
Its failure paths — the ones that matter, because a gate that cannot fail is
worse than no gate — are covered by `tests/validators.test.js`, which drives
every validator with no tools present and asserts it reports the missing tool.

Chasing a coverage number over the validator bodies would mean installing a
dozen large toolchains into this package to execute code that the consuming
repositories already execute for real.

## Adding a gate

1. Add the check to `lib/suite.js`.
2. Add a case to `tests/integration.test.js` that breaks exactly that thing and
   asserts the suite fails, naming the problem. Watch it fail before you make
   it pass.
3. Release. Consuming repositories pick it up on their next dependency bump.

A gate without a failing test is not a gate.

## Adding a validator

Export a function from `lib/validators.js` taking
`{ it, assert, root, pkg, config, kit }` and registering `it` blocks. It must
fail loudly when its tool is absent — use `loadTool` or `importTool`, which
throw with an actionable message. Then add its name to the tool-backed list in
`tests/validators.test.js`.
