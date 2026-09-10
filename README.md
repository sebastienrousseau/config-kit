<!-- SPDX-License-Identifier: Apache-2.0 OR MIT -->

# @sebastienrousseau/config-kit

The conformance suite for the `@sebastienrousseau` configuration family.

Every configuration package in the family calls `runSuite` from a one-line test
file. The gates live here, so adding one applies to all of them on the next
release rather than needing the same edit in dozens of repositories.

## Why it exists

The family used to carry a copy of the same test suite in every repository:
two templates, asserting that a module loads and is an object. They reported
100% line coverage over files that are mostly literals, and they missed every
defect that actually shipped:

- four packages whose `index.d.ts` contradicted their runtime export, so
  TypeScript consumers were mistyped
- a `semantic-release` preset naming six plugins and declaring none, two of
  which nothing else installed, so a consumer's release run died on plugin load
- an ESLint package whose CommonJS entry was eslintrc-shaped and could not load
  on the ESLint version it claimed to support
- a Stylelint config using three rules Stylelint had deleted, so every consumer
  saw three errors on every file
- a Biome config pinned to a superseded schema that Biome 2 rejected outright

One of those suites compared the two entrypoints with a chain of conditions and
no final branch. When the entrypoints disagreed — the exact thing it existed to
detect — no branch matched and it passed, asserting nothing.

## Usage

```js
// tests/conformance.test.js
require("@sebastienrousseau/config-kit").runSuite({ root: __dirname + "/.." });
```

Declare what the package is in `package.json`:

```json
{
  "configKit": {
    "shape": "object",
    "presets": ["rustfmt.toml", "clippy.toml"],
    "validate": "eslint-flat",
    "nativeToolchain": "rustfmt, clippy"
  }
}
```

| Field | Meaning |
| --- | --- |
| `shape` | `object`, `array` or `string`; asserted against both the runtime export and `index.d.ts` |
| `presets` | Files the package reads at runtime or ships for a tool; each must be in `files` and in the tarball |
| `validate` | Validator name, or omitted for structural checks only |
| `nativeToolchain` | Required when there is no JS validator: names the toolchain CI runs instead |
| `resolveIgnore` | Specifiers to exclude from the resolvability gate |
| `resolveExtra` | Specifiers to add to it |

## What it checks

- **Entrypoints** — CJS, ESM and the legacy `main` all load and export the same value
- **Types** — the shape `index.d.ts` promises matches what the module returns
- **Manifest** — licence, `engines.node`, `sideEffects`, conditional exports, keywords
- **Exports map** — every target exists and is in the `files` allowlist
- **Resolvability** — every package the configuration names can be loaded by a consumer
- **Tarball** — `npm pack` contains every export and preset, and no test or website files
- **Presets** — present, non-empty and structurally sound for their format
- **Layout** — the governance and documentation files the family standard requires
- **SPDX** — shipped sources and workflows declare their licence
- **Versions** — manifest, CHANGELOG, source literals and README pins agree
- **Documentation** — relative links resolve, no unresolved placeholders
- **The real tool** — where one exists, the tool is handed the configuration and must accept it

## Validators

| Name | What it proves |
| --- | --- |
| `eslint-flat` | ESLint accepts the config, and flags a missing semicolon under it |
| `prettier` | Formats, is idempotent, and every option is known to Prettier |
| `stylelint` | No rule the installed Stylelint has removed, and sloppy CSS is caught |
| `commitlint` | Accepts a conventional message and rejects a malformed one |
| `markdownlint` | Accepts clean Markdown and flags malformed Markdown |
| `remark` | Every configured plugin loads and is a valid unified attacher |
| `browserslist` | The query list resolves to real browsers |
| `typescript-tsconfig` | `tsc` compiles a project extending each preset |
| `semantic-release` | Every plugin installs and exposes a lifecycle hook |
| `biome` / `oxlint` | The CLI accepts the config file against a clean subject |
| `dockerfile` | Pinned base image, non-root user |
| `structural` | No JS validator exists; `nativeToolchain` must name the CI job that does |

Every validator has a test proving it fails when its tool is missing. A gate
that cannot fail is worse than no gate, because it reads as assurance.

## Development

```sh
npm ci
npm test          # unit, parser, validator and end-to-end suites
npm run test:unit # without the end-to-end fixtures
```

See [DEVELOPMENT.md](./DEVELOPMENT.md).

## Licence

Apache-2.0 OR MIT, at your option. See [LICENSE-APACHE](./LICENSE-APACHE) and
[LICENSE-MIT](./LICENSE-MIT).
