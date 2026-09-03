import { describe, expect, it } from "vitest";
import { createProvider } from "../src/providers/index";
import { runSpecs } from "../src/runner";
import { buildReport } from "../src/report";
import { expandSuite, type SuiteConfig } from "../src/suite";

const SMALL: SuiteConfig = {
  types: ["superseded", "distractor", "positional", "multihop"],
  contexts: [8000, 512000],
  positions: [0.05, 0.5, 0.95],
  casesPerCell: 2,
  seed: 7,
};

describe("end-to-end pipeline (offline mock providers)", () => {
  it("oracle scores perfectly across the whole suite", async () => {
    const rows = await runSpecs(createProvider("mock:oracle"), expandSuite(SMALL));
    expect(rows.length).toBe(expandSuite(SMALL).length);
    expect(rows.every((r) => r.parse_ok === 1)).toBe(true);
    expect(rows.every((r) => r.state_accuracy === 1)).toBe(true);
    expect(rows.every((r) => r.obsolete_rule_leakage === 0)).toBe(true);
    expect(rows.every((r) => r.constraint_violation === 0)).toBe(true);
  });

  it("naive model leaks obsolete rules and gets state wrong", async () => {
    const rows = await runSpecs(createProvider("mock:naive"), expandSuite(SMALL));
    const [report] = buildReport(rows);
    expect(report.overall.state_accuracy).toBe(0);
    // Leakage happens on the case types that carry superseded values.
    expect(report.overall.obsolete_leakage).toBeGreaterThan(0);
  });

  it("degrading model is worse at long context than short context", async () => {
    const rows = await runSpecs(createProvider("mock:degrading"), expandSuite(SMALL));
    const [report] = buildReport(rows);
    const short = report.byContext.find((b) => b.bucket <= 10000)!;
    const long = report.byContext.find((b) => b.bucket >= 400000)!;
    expect(short.agg.state_accuracy).toBeGreaterThan(long.agg.state_accuracy);
  });

  it("degrading model shows a lost-in-the-middle dip", async () => {
    // Use a larger sample so the probabilistic curve is stable.
    const big: SuiteConfig = { ...SMALL, contexts: [256000], casesPerCell: 40 };
    const rows = await runSpecs(createProvider("mock:degrading"), expandSuite(big));
    const [report] = buildReport(rows);
    const at = (p: number) =>
      report.byPosition.find((x) => Math.abs(x.position - p) < 1e-9)!.agg.state_accuracy;
    const middle = at(0.5);
    const edges = (at(0.05) + at(0.95)) / 2;
    expect(middle).toBeLessThan(edges);
  });
});
