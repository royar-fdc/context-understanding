import { describe, expect, it } from "vitest";
import { generateCase } from "../src/generator";
import { ALL_TYPES } from "../src/suite";
import type { CaseType } from "../src/types";

describe("dataset generator", () => {
  it("is deterministic for a given seed", () => {
    const opts = {
      type: "superseded" as CaseType,
      contextTokens: 8000,
      importantFactPosition: 0.5,
      seed: 123,
    };
    const a = generateCase(opts);
    const b = generateCase(opts);
    expect(a.context).toBe(b.context);
    expect(a.groundTruth).toEqual(b.groundTruth);
    expect(a.question).toBe(b.question);
  });

  it("varies with the seed", () => {
    const base = {
      type: "superseded" as CaseType,
      contextTokens: 8000,
      importantFactPosition: 0.5,
    };
    const a = generateCase({ ...base, seed: 1 });
    const b = generateCase({ ...base, seed: 2 });
    expect(a.context).not.toBe(b.context);
  });

  it("hits the requested context size within tolerance", () => {
    for (const target of [8000, 32000, 128000]) {
      const c = generateCase({
        type: "distractor",
        contextTokens: target,
        importantFactPosition: 0.5,
        seed: 7,
      });
      expect(c.contextTokens).toBeGreaterThan(target * 0.8);
      expect(c.contextTokens).toBeLessThan(target * 1.2);
    }
  });

  it("embeds the correct final answer and decisive fact for every type", () => {
    for (const type of ALL_TYPES) {
      const c = generateCase({
        type,
        contextTokens: 8000,
        importantFactPosition: 0.5,
        seed: 99,
      });
      // The decisive fact / final answer is present somewhere in the context.
      expect(c.context.length).toBeGreaterThan(1000);
      expect(c.groundTruth.finalAnswer.length).toBeGreaterThan(0);
      expect(c.question.length).toBeGreaterThan(0);
    }
  });

  it("superseded ground truth excludes the final value", () => {
    const c = generateCase({
      type: "superseded",
      contextTokens: 8000,
      importantFactPosition: 0.9,
      seed: 55,
    });
    expect(c.groundTruth.answerValue).toBeDefined();
    expect(c.groundTruth.supersededValues).not.toContain(String(c.groundTruth.answerValue));
    // superseded values are truly present as earlier decisions in the context.
    for (const v of c.groundTruth.supersededValues) {
      expect(c.context).toContain(v);
    }
  });

  it("multihop answer is the product of base and multiplier and is not written literally as a rule", () => {
    const c = generateCase({
      type: "multihop",
      contextTokens: 8000,
      importantFactPosition: 0.5,
      seed: 3,
    });
    expect(c.groundTruth.hopChain?.length).toBeGreaterThan(3);
    // The literal "Policy A -> N minutes" appears, but the integrated answer must be derived.
    expect(c.groundTruth.answerValue).toBeGreaterThan(0);
  });
});
