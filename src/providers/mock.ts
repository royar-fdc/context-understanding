/**
 * Offline, deterministic mock providers ("simulators").
 *
 * These are NOT real models. They exist so the entire pipeline (generate -> run ->
 * score -> report) runs end-to-end without API keys, and so the scorer's behavior
 * is verifiable in unit tests. Because a simulator can legitimately read the
 * ground truth, it implements the `Simulator` interface and the runner feeds it
 * the case directly.
 *
 * Three behaviors are provided:
 *  - oracle:    always answers from the current (final) state  -> perfect scores.
 *  - naive:     anchors on the earliest/obsolete decision      -> leakage + errors.
 *  - degrading: correctness falls as context grows and dips in the middle,
 *               reproducing the long-context degradation the benchmark targets.
 */

import { Rng } from "../rng.js";
import type { BenchCase, ModelAnswer, ProviderResult } from "../types.js";

export interface Simulator {
  readonly isSimulator: true;
  readonly name: string;
  simulate(c: BenchCase): ProviderResult;
}

export function isSimulator(p: unknown): p is Simulator {
  return typeof p === "object" && p !== null && (p as Simulator).isSimulator === true;
}

function result(answer: ModelAnswer): ProviderResult {
  return {
    raw: JSON.stringify(answer),
    parsed: answer,
    latencyMs: 0,
    usage: {},
  };
}

function correctAnswer(c: BenchCase): ModelAnswer {
  return {
    final_answer: c.groundTruth.finalAnswer,
    superseded_rules: c.groundTruth.supersededValues,
    evidence: c.groundTruth.hopChain ?? ["final decision log entry"],
  };
}

/** A wrong answer that mimics a realistic failure mode for the case type. */
function wrongAnswer(c: BenchCase): ModelAnswer {
  const gt = c.groundTruth;
  if (gt.supersededValues.length > 0) {
    // Leakage: reuse an obsolete value as if it were current.
    const leaked = gt.supersededValues[0];
    return {
      final_answer: leaked,
      superseded_rules: [],
      evidence: ["(anchored on an earlier decision)"],
    };
  }
  if (c.type === "positional") {
    // Constraint violation: fall back to the deprecated API-key approach.
    return {
      final_answer: "static API key",
      superseded_rules: [],
      evidence: ["(legacy note about API keys)"],
    };
  }
  if (c.type === "multihop" && gt.hopChain) {
    // Failed integration: stop at Policy A's base value instead of multiplying.
    const base = gt.hopChain.find((h) => /Policy A ->/.test(h));
    const num = base?.match(/(\d+)/)?.[1] ?? "0";
    return {
      final_answer: `${num} minutes`,
      superseded_rules: [],
      evidence: ["(did not apply the Policy B multiplier)"],
    };
  }
  return { final_answer: "unknown", superseded_rules: [], evidence: [] };
}

export function makeOracle(): Simulator {
  return {
    isSimulator: true,
    name: "mock:oracle",
    simulate: (c) => result(correctAnswer(c)),
  };
}

export function makeNaive(): Simulator {
  return {
    isSimulator: true,
    name: "mock:naive",
    simulate: (c) => result(wrongAnswer(c)),
  };
}

export interface DegradingOptions {
  /** Max fraction of accuracy lost from context growth (8k -> ~1M). */
  contextPenalty?: number;
  /** Max fraction lost at the exact middle (lost-in-the-middle depth). */
  middleDip?: number;
}

/**
 * A simulator whose probability of answering correctly declines with context
 * length and dips for facts placed in the middle of the context. This models the
 * exact phenomenon the benchmark is built to detect.
 */
export function makeDegrading(opts: DegradingOptions = {}): Simulator {
  const contextPenalty = opts.contextPenalty ?? 0.55;
  const middleDip = opts.middleDip ?? 0.25;

  const typeFactor: Record<BenchCase["type"], number> = {
    positional: 1.0,
    superseded: 0.95,
    distractor: 0.9,
    multihop: 0.82, // integration is the hardest.
  };

  return {
    isSimulator: true,
    name: "mock:degrading",
    simulate(c: BenchCase): ProviderResult {
      const pCorrect = probabilityCorrect(c, contextPenalty, middleDip, typeFactor);
      // Deterministic per case, decorrelated from generation.
      const rng = new Rng((c.seed ^ 0x9e3779b9) >>> 0);
      const answer = rng.next() < pCorrect ? correctAnswer(c) : wrongAnswer(c);
      return result(answer);
    },
  };
}

function probabilityCorrect(
  c: BenchCase,
  contextPenalty: number,
  middleDip: number,
  typeFactor: Record<BenchCase["type"], number>,
): number {
  const lo = Math.log10(8000);
  const hi = Math.log10(1_000_000);
  const t = clamp((Math.log10(Math.max(c.contextTokens, 8000)) - lo) / (hi - lo), 0, 1);
  const ctxFactor = 1 - t * contextPenalty;

  // Bell centered at 0.5 -> deepest penalty in the middle of the context.
  const sigma = 0.18;
  const bell = Math.exp(-((c.importantFactPosition - 0.5) ** 2) / (2 * sigma * sigma));
  const posFactor = 1 - middleDip * bell;

  return clamp(0.99 * ctxFactor * posFactor * typeFactor[c.type], 0.02, 0.999);
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}
