import { describe, expect, it } from "vitest";
import { charsForTokens, estimateTokens } from "../src/tokens";

describe("token estimation", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("is monotonic in length", () => {
    const a = estimateTokens("x".repeat(100));
    const b = estimateTokens("x".repeat(1000));
    expect(b).toBeGreaterThan(a);
  });

  it("round-trips approximately with charsForTokens", () => {
    const target = 32000;
    const chars = charsForTokens(target);
    const est = estimateTokens("a".repeat(chars));
    // Within 25% of the requested bucket.
    expect(est).toBeGreaterThan(target * 0.75);
    expect(est).toBeLessThan(target * 1.25);
  });
});
