/**
 * Prompt construction.
 *
 * The system prompt is intentionally minimal (per the experiment design: keep the
 * harness thin so results are attributable to the model, not to context
 * engineering). We enforce a strict JSON output contract so scoring is
 * deterministic and offline.
 */

import type { BenchCase } from "./types.js";

export const SYSTEM_PROMPT = [
  "You are a senior engineer answering questions about an existing software project.",
  "You are given the full project history as context. Some decisions were later",
  "superseded, some rules apply only to a specific scope, and some facts must be",
  "combined to answer. Always answer according to the CURRENT (final) state of the",
  "project, ignoring superseded decisions.",
  "",
  "Respond with a single JSON object and nothing else, matching exactly:",
  '{"final_answer": string, "superseded_rules": string[], "evidence": string[]}',
  "- final_answer: the current, correct answer to the question.",
  "- superseded_rules: earlier values/decisions that no longer apply.",
  "- evidence: short quotes or references from the context supporting your answer.",
].join("\n");

export function buildUserPrompt(c: BenchCase): string {
  return [
    "=== PROJECT HISTORY (context) ===",
    c.context,
    "",
    "=== QUESTION ===",
    c.question,
    "",
    "Return ONLY the JSON object described in the system instruction.",
  ].join("\n");
}
