/**
 * Suite expansion: turn a compact matrix description into concrete case specs.
 *
 * A suite is the cross product of {case types} x {context lengths} x {positions}
 * x {N independent seeds}. Using independent seeds per cell (rather than repeating
 * one prompt) means the model is tested on distinct problem instances, so a lucky
 * or unlucky single dataset cannot dominate the score.
 */

import type { GenerateOptions } from "./generator.js";
import type { CaseType } from "./types.js";

export interface SuiteConfig {
  types: CaseType[];
  contexts: number[];
  positions: number[];
  casesPerCell: number;
  seed: number;
}

export const DEFAULT_SUITE: SuiteConfig = {
  types: ["superseded", "distractor", "positional", "multihop"],
  contexts: [8000, 32000, 128000, 512000],
  positions: [0.05, 0.25, 0.5, 0.75, 0.95],
  casesPerCell: 3,
  seed: 42,
};

export function expandSuite(cfg: SuiteConfig): GenerateOptions[] {
  const specs: GenerateOptions[] = [];
  let counter = 0;
  for (const type of cfg.types) {
    for (const contextTokens of cfg.contexts) {
      for (const importantFactPosition of cfg.positions) {
        for (let k = 0; k < cfg.casesPerCell; k++) {
          // Distinct, stable seed per case for reproducibility.
          const seed = (cfg.seed * 1_000_003 + counter++ * 2_654_435_761) >>> 0;
          specs.push({ type, contextTokens, importantFactPosition, seed });
        }
      }
    }
  }
  return specs;
}

export const ALL_TYPES: CaseType[] = [
  "superseded",
  "distractor",
  "positional",
  "multihop",
];
