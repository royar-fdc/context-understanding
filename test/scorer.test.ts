import { describe, expect, it } from "vitest";
import { generateCase } from "../src/generator";
import { scoreCase } from "../src/scorer";
import type { BenchCase, ProviderResult, ModelAnswer } from "../src/types";

function answer(a: Partial<ModelAnswer>): ProviderResult {
  const parsed: ModelAnswer = {
    final_answer: a.final_answer ?? "",
    superseded_rules: a.superseded_rules ?? [],
    evidence: a.evidence ?? [],
  };
  return { raw: JSON.stringify(parsed), parsed, latencyMs: 1 };
}

function make(type: BenchCase["type"], seed = 1): BenchCase {
  return generateCase({ type, contextTokens: 8000, importantFactPosition: 0.5, seed });
}

describe("scorer", () => {
  it("marks a perfect answer correct with no leakage/violation", () => {
    const c = make("superseded");
    const row = scoreCase(c, answer({ final_answer: c.groundTruth.finalAnswer }));
    expect(row.parse_ok).toBe(1);
    expect(row.state_accuracy).toBe(1);
    expect(row.obsolete_rule_leakage).toBe(0);
    expect(row.constraint_violation).toBe(0);
  });

  it("detects obsolete-rule leakage when an old value is reused", () => {
    const c = make("superseded");
    const old = c.groundTruth.supersededValues[0];
    const row = scoreCase(c, answer({ final_answer: `${old} minutes` }));
    expect(row.state_accuracy).toBe(0);
    expect(row.obsolete_rule_leakage).toBe(1);
  });

  it("is unit-aware: 30s is not accepted for a 30-minute answer", () => {
    const c: BenchCase = {
      ...make("distractor"),
      groundTruth: {
        finalAnswer: "30m",
        answerValue: 30,
        supersededValues: [],
        constraints: [],
      },
    };
    expect(scoreCase(c, answer({ final_answer: "30m" })).state_accuracy).toBe(1);
    expect(scoreCase(c, answer({ final_answer: "30 minutes" })).state_accuracy).toBe(1);
    expect(scoreCase(c, answer({ final_answer: "30s" })).state_accuracy).toBe(0);
  });

  it("flags architectural constraint violations (positional)", () => {
    const c = make("positional");
    const good = scoreCase(c, answer({ final_answer: "workload identity" }));
    expect(good.state_accuracy).toBe(1);
    expect(good.constraint_violation).toBe(0);

    const bad = scoreCase(c, answer({ final_answer: "static API key" }));
    expect(bad.state_accuracy).toBe(0);
    expect(bad.constraint_violation).toBe(1);
  });

  it("tracks integration accuracy only for multihop", () => {
    const mh = make("multihop");
    const good = scoreCase(mh, answer({ final_answer: mh.groundTruth.finalAnswer }));
    expect(good.integration_accuracy).toBe(1);

    const sup = make("superseded");
    const row = scoreCase(sup, answer({ final_answer: sup.groundTruth.finalAnswer }));
    expect(row.integration_accuracy).toBeNull();
  });

  it("marks unparseable output as parse_ok=0 and everything else 0", () => {
    const c = make("superseded");
    const res: ProviderResult = { raw: "sorry, I cannot help", parsed: null, latencyMs: 1 };
    const row = scoreCase(c, res);
    expect(row.parse_ok).toBe(0);
    expect(row.state_accuracy).toBe(0);
  });
});
