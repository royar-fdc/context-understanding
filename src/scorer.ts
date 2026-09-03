/**
 * Deterministic, offline scorer.
 *
 * Given a case and a provider result, it emits the five metrics the benchmark
 * cares about. All comparisons are normalized (case-insensitive, punctuation- and
 * whitespace-insensitive) with unit-aware numeric handling so "30s" is never
 * accepted for a "30 minutes" answer.
 */

import type { BenchCase, ProviderResult, ResultRow } from "./types.js";

export function scoreCase(c: BenchCase, res: ProviderResult): ResultRow {
  const parsed = res.parsed;
  const parseOk = parsed ? 1 : 0;
  const finalAnswer = parsed?.final_answer ?? "";

  const stateOk = parsed ? (matchesFinal(finalAnswer, c) ? 1 : 0) : 0;
  const leakage = parsed && leaked(finalAnswer, c) ? 1 : 0;
  const violation = parsed && violatesConstraint(finalAnswer, c) ? 1 : 0;
  const integration = c.type === "multihop" ? ((stateOk === 1 ? 1 : 0) as 0 | 1) : null;

  return {
    case: c.id,
    type: c.type,
    model: "", // filled in by the runner
    context_bucket: c.targetTokens,
    context_tokens: c.contextTokens,
    important_fact_position: c.importantFactPosition,
    answer: finalAnswer,
    expected: c.groundTruth.finalAnswer,
    parse_ok: parseOk as 0 | 1,
    state_accuracy: stateOk as 0 | 1,
    obsolete_rule_leakage: leakage as 0 | 1,
    integration_accuracy: integration,
    constraint_violation: violation as 0 | 1,
    latency_ms: res.latencyMs,
    input_tokens: res.usage?.inputTokens,
    output_tokens: res.usage?.outputTokens,
  };
}

// --------------------------------------------------------------------------

function matchesFinal(answer: string, c: BenchCase): boolean {
  const na = norm(answer);
  const target = norm(c.groundTruth.finalAnswer);
  if (!na || !target) return false;
  if (na.includes(target)) return true;

  const av = c.groundTruth.answerValue;
  if (av === undefined) return false;
  if (!numbersIn(na).includes(av)) return false;

  const gtUnit = unitCanonical(c.groundTruth.finalAnswer);
  if (!gtUnit) return true; // no distinguishing unit required
  if (!/[a-z]/.test(na)) return true; // bare number -> benefit of the doubt
  return unitCanonicalFromNorm(na) === gtUnit;
}

/** True if the answer reuses one of the superseded values as the current answer. */
function leaked(answer: string, c: BenchCase): boolean {
  return c.groundTruth.supersededValues.some((sv) => valueEquals(answer, sv));
}

function violatesConstraint(answer: string, c: BenchCase): boolean {
  const na = norm(answer);
  return c.groundTruth.constraints.some((k) => na.includes(norm(k)));
}

/** Compare a free-text answer against a specific value string ("15", "30s"). */
function valueEquals(answer: string, value: string): boolean {
  const na = norm(answer);
  const nv = norm(value);
  const vNums = numbersIn(nv);
  if (vNums.length === 0) {
    return na.includes(nv);
  }
  const aNums = numbersIn(na);
  if (!aNums.includes(vNums[0])) return false;
  const vUnit = unitCanonicalFromNorm(nv);
  if (!vUnit) return true;
  const aUnit = unitCanonicalFromNorm(na);
  // If the answer has no unit, treat the number match as sufficient.
  return aUnit === "" || aUnit === vUnit;
}

// --- normalization utilities ---------------------------------------------

/** Lowercase and strip everything that isn't a letter or digit. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function numbersIn(normalized: string): number[] {
  const matches = normalized.match(/\d+/g);
  return matches ? matches.map((m) => parseInt(m, 10)) : [];
}

/** Canonical unit inferred from a raw value string. */
function unitCanonical(raw: string): string {
  return unitCanonicalFromNorm(norm(raw));
}

/** Canonical unit from an already-normalized string. */
function unitCanonicalFromNorm(n: string): string {
  const alpha = n.replace(/[0-9]/g, "");
  if (!alpha) return "";
  if (/(minutes|minute|mins|min|^m$|^m)/.test(alpha) && !/second/.test(alpha)) {
    return "minutes";
  }
  if (/(seconds|second|secs|sec|^s$|^s)/.test(alpha)) return "seconds";
  if (/(hours|hour|hrs|hr|^h$)/.test(alpha)) return "hours";
  return alpha; // non-time unit; compare literally
}
