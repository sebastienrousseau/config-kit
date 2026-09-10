// SPDX-FileCopyrightText: 2026 Sebastien Rousseau <sebastian.rousseau@gmail.com>
// SPDX-License-Identifier: Apache-2.0 OR MIT

/** Options accepted by {@link runSuite}. */
export interface SuiteOptions {
  /** Package root to audit. Defaults to `process.cwd()`. */
  root?: string;
}

/** Register the family conformance suite for one configuration package. */
export function runSuite(options?: SuiteOptions): void;

/** Files every repository in the family must carry. */
export const REQUIRED_FILES: readonly string[];

/** Domain validators, keyed by the name used in `configKit.validate`. */
export const validators: Record<string, (context: unknown) => void>;
