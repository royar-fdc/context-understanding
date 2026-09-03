/**
 * Runner: drive a provider over a set of cases and produce scored result rows.
 *
 * To keep memory bounded even at ~1M-token contexts, cases are generated lazily
 * from lightweight specs; each context is scored and then discarded.
 */

import { generateCase, type GenerateOptions } from "./generator.js";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.js";
import { isSimulator, type AnyProvider } from "./providers/index.js";
import { scoreCase } from "./scorer.js";
import type { BenchCase, ResultRow } from "./types.js";

export interface RunOptions {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Run a provider over already-materialized cases. */
export async function runCases(
  provider: AnyProvider,
  cases: BenchCase[],
  opts: RunOptions = {},
): Promise<ResultRow[]> {
  return runLazy(provider, cases.length, (i) => cases[i], opts);
}

/** Run a provider over cases described by specs, generating each on demand. */
export async function runSpecs(
  provider: AnyProvider,
  specs: GenerateOptions[],
  opts: RunOptions = {},
): Promise<ResultRow[]> {
  return runLazy(provider, specs.length, (i) => generateCase(specs[i]), opts);
}

async function runLazy(
  provider: AnyProvider,
  total: number,
  make: (i: number) => BenchCase,
  opts: RunOptions,
): Promise<ResultRow[]> {
  const concurrency = Math.max(1, opts.concurrency ?? (isSimulator(provider) ? 16 : 4));
  const rows: ResultRow[] = new Array(total);
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const c = make(i);
      const row = await runOne(provider, c);
      rows[i] = row;
      done++;
      opts.onProgress?.(done, total);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
  return rows;
}

export async function runOne(provider: AnyProvider, c: BenchCase): Promise<ResultRow> {
  const res = isSimulator(provider)
    ? provider.simulate(c)
    : await provider.complete({ system: SYSTEM_PROMPT, user: buildUserPrompt(c) });
  const row = scoreCase(c, res);
  row.model = provider.name;
  return row;
}
