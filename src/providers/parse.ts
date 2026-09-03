/**
 * Robust extraction of the JSON answer object from a model's raw text output.
 * Handles code fences and leading/trailing prose by scanning for the first
 * balanced top-level object.
 */

import type { ModelAnswer } from "../types.js";

export function parseModelAnswer(raw: string): ModelAnswer | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;
  try {
    const obj = JSON.parse(jsonText) as Record<string, unknown>;
    const final_answer =
      typeof obj.final_answer === "string" ? obj.final_answer : "";
    const superseded_rules = toStringArray(obj.superseded_rules);
    const evidence = toStringArray(obj.evidence);
    if (!final_answer && superseded_rules.length === 0 && evidence.length === 0) {
      return null;
    }
    return { final_answer, superseded_rules, evidence };
  } catch {
    return null;
  }
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** Find the first balanced { ... } block, ignoring braces inside strings. */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }
  return null;
}
