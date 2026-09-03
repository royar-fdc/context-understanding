/**
 * Aggregation and human-readable reporting of scored results.
 *
 * Produces the curves the benchmark is designed to expose: accuracy vs. context
 * length, and accuracy vs. the position of the decisive fact (lost-in-the-middle).
 */

import type { ResultRow } from "./types.js";

export interface Aggregate {
  n: number;
  parse_rate: number;
  state_accuracy: number;
  obsolete_leakage: number;
  integration_accuracy: number | null;
  constraint_violation: number;
}

function aggregate(rows: ResultRow[]): Aggregate {
  const n = rows.length;
  if (n === 0) {
    return {
      n: 0,
      parse_rate: 0,
      state_accuracy: 0,
      obsolete_leakage: 0,
      integration_accuracy: null,
      constraint_violation: 0,
    };
  }
  const integ = rows.filter((r) => r.integration_accuracy !== null);
  return {
    n,
    parse_rate: mean(rows.map((r) => r.parse_ok)),
    state_accuracy: mean(rows.map((r) => r.state_accuracy)),
    obsolete_leakage: mean(rows.map((r) => r.obsolete_rule_leakage)),
    integration_accuracy:
      integ.length > 0 ? mean(integ.map((r) => r.integration_accuracy as number)) : null,
    constraint_violation: mean(rows.map((r) => r.constraint_violation)),
  };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function groupBy<K>(rows: ResultRow[], key: (r: ResultRow) => K): Map<K, ResultRow[]> {
  const m = new Map<K, ResultRow[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  return m;
}

export interface ReportModel {
  model: string;
  overall: Aggregate;
  byContext: { bucket: number; agg: Aggregate }[];
  byPosition: { position: number; agg: Aggregate }[];
  byType: { type: string; agg: Aggregate }[];
}

export function buildReport(rows: ResultRow[]): ReportModel[] {
  const byModel = groupBy(rows, (r) => r.model);
  const out: ReportModel[] = [];
  for (const [model, mrows] of byModel) {
    const byContext = [...groupBy(mrows, (r) => r.context_bucket).entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bucket, rs]) => ({ bucket, agg: aggregate(rs) }));
    const byPosition = [...groupBy(mrows, (r) => r.important_fact_position).entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([position, rs]) => ({ position, agg: aggregate(rs) }));
    const byType = [...groupBy(mrows, (r) => r.type).entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([type, rs]) => ({ type, agg: aggregate(rs) }));
    out.push({ model, overall: aggregate(mrows), byContext, byPosition, byType });
  }
  return out;
}

// --- text rendering -------------------------------------------------------

const pct = (x: number | null): string => (x === null ? "  n/a" : `${(x * 100).toFixed(0).padStart(3)}%`);

function fmtTokens(t: number): string {
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`;
  if (t >= 1000) return `${Math.round(t / 1000)}k`;
  return `${t}`;
}

export function renderReport(models: ReportModel[]): string {
  const lines: string[] = [];
  for (const m of models) {
    lines.push("");
    lines.push(`########## MODEL: ${m.model} ##########`);
    lines.push(row("Overall", m.overall));
    lines.push("");
    lines.push("By context length:");
    lines.push(headerRow("context"));
    for (const b of m.byContext) lines.push(row(fmtTokens(b.bucket), b.agg));
    lines.push("");
    lines.push("By decisive-fact position (lost-in-the-middle):");
    lines.push(headerRow("position"));
    for (const p of m.byPosition) {
      lines.push(row(`${Math.round(p.position * 100)}%`, p.agg));
    }
    lines.push("");
    lines.push("By case type:");
    lines.push(headerRow("type"));
    for (const t of m.byType) lines.push(row(t.type, t.agg));
  }
  return lines.join("\n");
}

function headerRow(label: string): string {
  return (
    `  ${label.padEnd(10)} | n   | parse | state | leak  | integ | violate`
  );
}

function row(label: string, a: Aggregate): string {
  return (
    `  ${label.padEnd(10)} | ${String(a.n).padStart(3)} | ${pct(a.parse_rate)} | ` +
    `${pct(a.state_accuracy)} | ${pct(a.obsolete_leakage)} | ${pct(a.integration_accuracy)} | ${pct(a.constraint_violation)}`
  );
}
