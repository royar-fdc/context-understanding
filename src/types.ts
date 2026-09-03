/**
 * Core types shared across the benchmark runner.
 *
 * The benchmark deliberately distinguishes *retrieval* (find a fact in a haystack)
 * from *understanding* (resolve contradictions, respect scope, follow chronology,
 * integrate multiple facts). Every case therefore ships with a machine-checkable
 * ground truth so scoring is deterministic and offline.
 */

/** The four "brutal" case families this runner generates. */
export type CaseType =
  | "superseded" // A -> B -> C decisions; only the final one is correct.
  | "distractor" // Many semantically-similar entities; pick the right one + version.
  | "positional" // One critical rule placed at a controlled position (lost-in-the-middle).
  | "multihop"; // Answer never written literally; must integrate a chain of facts.

/** Ground truth used by the scorer. All comparisons are normalized. */
export interface GroundTruth {
  /** Canonical correct final answer, e.g. "30 minutes" or "30". */
  finalAnswer: string;
  /** Numeric form of the answer when applicable (enables tolerant numeric compare). */
  answerValue?: number;
  /** Values that were true earlier but are now superseded; must NOT be used as the answer. */
  supersededValues: string[];
  /**
   * Hard constraints expressed as substrings/patterns that must NOT appear in the
   * model's final answer or implementation (e.g. an architecturally-forbidden call).
   */
  constraints: string[];
  /** For multi-hop cases: the ordered reasoning chain the model must traverse. */
  hopChain?: string[];
}

export interface BenchCase {
  id: string;
  type: CaseType;
  /** Requested/target context size in tokens (the bucket this case belongs to). */
  targetTokens: number;
  /** Estimated actual size of the generated context in tokens. */
  contextTokens: number;
  /** Fractional position (0..1) of the decisive fact inside the context. */
  importantFactPosition: number;
  /** The synthetic long-context project history. */
  context: string;
  /** The final question posed to the model. */
  question: string;
  groundTruth: GroundTruth;
  /** Seed used to generate this case (for reproducibility). */
  seed: number;
}

/** The strict JSON contract we ask every model to return. */
export interface ModelAnswer {
  final_answer: string;
  superseded_rules: string[];
  evidence: string[];
}

export interface ProviderResult {
  /** Raw text returned by the provider. */
  raw: string;
  /** Parsed answer if the raw text contained valid JSON, else null. */
  parsed: ModelAnswer | null;
  /** Token usage if the provider reports it. */
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Wall-clock latency in ms. */
  latencyMs: number;
}

export interface Provider {
  /** Stable identifier, e.g. "gemini-3.8-flash" or "mock:degrading". */
  name: string;
  /** Run a single completion. Must return the raw text and parsed answer. */
  complete(input: { system: string; user: string }): Promise<ProviderResult>;
}

/** One scored row, appended to a JSONL results file. */
export interface ResultRow {
  case: string;
  type: CaseType;
  model: string;
  /** Target bucket the case belongs to (used for grouping in reports). */
  context_bucket: number;
  /** Estimated actual context size. */
  context_tokens: number;
  important_fact_position: number;
  answer: string;
  expected: string;
  /** Model returned parseable, contract-conforming JSON. */
  parse_ok: 0 | 1;
  /** Final answer matches ground truth. */
  state_accuracy: 0 | 1;
  /** An obsolete value was used in the final answer. */
  obsolete_rule_leakage: 0 | 1;
  /** Multi-hop answer correct (null for non-multihop cases). */
  integration_accuracy: 0 | 1 | null;
  /** A hard architectural constraint was violated. */
  constraint_violation: 0 | 1;
  latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
}
