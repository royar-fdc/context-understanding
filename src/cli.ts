#!/usr/bin/env node
/**
 * lcbench — a mini long-context *understanding* benchmark runner.
 *
 * Commands:
 *   demo      Run the built-in suite against mock models (offline) and print a report.
 *   bench     Generate + run + score a suite against a real/mock model, print a report.
 *   generate  Write a dataset (context/question/ground-truth files) to disk.
 *   run       Run a model over a dataset directory, write JSONL results.
 *   report    Aggregate one or more JSONL result files into a report.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateCase } from "./generator.js";
import { buildReport, renderReport } from "./report.js";
import { createProvider } from "./providers/index.js";
import { runCases, runSpecs } from "./runner.js";
import { DEFAULT_SUITE, expandSuite, type SuiteConfig } from "./suite.js";
import type { BenchCase, CaseType, ResultRow } from "./types.js";

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const flags = parseFlags(rest);
  switch (cmd) {
    case "demo":
      return cmdDemo(flags);
    case "bench":
      return cmdBench(flags);
    case "generate":
      return cmdGenerate(flags);
    case "run":
      return cmdRun(flags);
    case "report":
      return cmdReport(flags);
    case "help":
    case undefined:
    case "--help":
    case "-h":
      printHelp();
      return 0;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      printHelp();
      return 1;
  }
}

// --------------------------------------------------------------------------

async function cmdDemo(flags: Flags): Promise<number> {
  const outDir = str(flags, "out", ".demo");
  const models = list(flags, "models", ["mock:degrading", "mock:oracle", "mock:naive"]);
  const suite = suiteFromFlags(flags);

  console.log("Running offline demo suite (mock models, no API keys required).");
  console.log(
    `Suite: ${suite.types.length} types x ${suite.contexts.length} contexts x ` +
      `${suite.positions.length} positions x ${suite.casesPerCell} cases = ` +
      `${expandSuite(suite).length} cases per model.\n`,
  );

  await mkdir(outDir, { recursive: true });
  const allRows: ResultRow[] = [];
  for (const spec of models) {
    const provider = createProvider(spec);
    const rows = await runSpecs(provider, expandSuite(suite), {
      onProgress: progress(provider.name),
    });
    process.stdout.write("\n");
    const file = join(outDir, `${sanitize(provider.name)}.jsonl`);
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`  wrote ${rows.length} rows -> ${file}`);
    allRows.push(...rows);
  }

  const report = renderReport(buildReport(allRows));
  console.log(report);
  const reportFile = join(outDir, "report.txt");
  await writeFile(reportFile, report + "\n");
  console.log(`\nReport written to ${reportFile}`);
  return 0;
}

async function cmdBench(flags: Flags): Promise<number> {
  const model = str(flags, "model", "mock:degrading");
  const suite = suiteFromFlags(flags);
  const provider = createProvider(model, {
    thinking: strOpt(flags, "thinking"),
    temperature: numOpt(flags, "temperature"),
  });
  const specs = expandSuite(suite);
  console.log(`Benchmarking ${provider.name} over ${specs.length} cases...`);
  const rows = await runSpecs(provider, specs, {
    concurrency: numOpt(flags, "concurrency"),
    onProgress: progress(provider.name),
  });
  process.stdout.write("\n");
  const report = renderReport(buildReport(rows));
  console.log(report);
  if (flags.out) {
    const file = str(flags, "out", "results.jsonl");
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`\nResults written to ${file}`);
  }
  return 0;
}

async function cmdGenerate(flags: Flags): Promise<number> {
  const outDir = str(flags, "out", "datasets");
  const suite = suiteFromFlags(flags);
  const specs = expandSuite(suite);
  await mkdir(outDir, { recursive: true });
  console.log(`Generating ${specs.length} cases into ${outDir}/ ...`);
  const index: unknown[] = [];
  let i = 0;
  for (const spec of specs) {
    const c = generateCase(spec);
    const dir = join(outDir, c.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "context.md"), c.context);
    await writeFile(join(dir, "question.md"), c.question + "\n");
    await writeFile(join(dir, "ground-truth.json"), JSON.stringify(c.groundTruth, null, 2) + "\n");
    await writeFile(
      join(dir, "meta.json"),
      JSON.stringify(
        {
          id: c.id,
          type: c.type,
          targetTokens: c.targetTokens,
          contextTokens: c.contextTokens,
          importantFactPosition: c.importantFactPosition,
          seed: c.seed,
        },
        null,
        2,
      ) + "\n",
    );
    index.push({ id: c.id, type: c.type, contextTokens: c.contextTokens });
    if (++i % 20 === 0) process.stdout.write(`  ${i}/${specs.length}\r`);
  }
  await writeFile(join(outDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  console.log(`\nDone. ${specs.length} cases in ${outDir}/`);
  return 0;
}

async function cmdRun(flags: Flags): Promise<number> {
  const dataset = str(flags, "dataset", "datasets");
  const model = str(flags, "model", "mock:degrading");
  const provider = createProvider(model, {
    thinking: strOpt(flags, "thinking"),
    temperature: numOpt(flags, "temperature"),
  });
  const cases = await loadDataset(dataset);
  if (cases.length === 0) {
    console.error(`No cases found in ${dataset}/. Run "generate" first.`);
    return 1;
  }
  console.log(`Running ${provider.name} over ${cases.length} cases from ${dataset}/ ...`);
  const rows = await runCases(provider, cases, {
    concurrency: numOpt(flags, "concurrency"),
    onProgress: progress(provider.name),
  });
  process.stdout.write("\n");
  const outFile = str(flags, "out", `results/${sanitize(provider.name)}.jsonl`);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`Wrote ${rows.length} rows -> ${outFile}`);
  console.log(renderReport(buildReport(rows)));
  return 0;
}

async function cmdReport(flags: Flags): Promise<number> {
  const files = list(flags, "results", []);
  if (files.length === 0) {
    console.error('Provide --results file1.jsonl,file2.jsonl');
    return 1;
  }
  const rows: ResultRow[] = [];
  for (const f of files) {
    const text = await readFile(f, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t) rows.push(JSON.parse(t) as ResultRow);
    }
  }
  console.log(renderReport(buildReport(rows)));
  return 0;
}

// --------------------------------------------------------------------------
// dataset io
// --------------------------------------------------------------------------

async function loadDataset(dir: string): Promise<BenchCase[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const cases: BenchCase[] = [];
  for (const name of entries) {
    const caseDir = join(dir, name);
    try {
      const [context, question, gt, meta] = await Promise.all([
        readFile(join(caseDir, "context.md"), "utf8"),
        readFile(join(caseDir, "question.md"), "utf8"),
        readFile(join(caseDir, "ground-truth.json"), "utf8"),
        readFile(join(caseDir, "meta.json"), "utf8"),
      ]);
      const m = JSON.parse(meta) as {
        id: string;
        type: CaseType;
        targetTokens: number;
        contextTokens: number;
        importantFactPosition: number;
        seed: number;
      };
      cases.push({
        ...m,
        context,
        question: question.trim(),
        groundTruth: JSON.parse(gt),
      });
    } catch {
      // Not a case directory (e.g. index.json); skip.
    }
  }
  return cases;
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

function suiteFromFlags(flags: Flags): SuiteConfig {
  return {
    types: (list(flags, "types", DEFAULT_SUITE.types) as CaseType[]),
    contexts: list(flags, "contexts", DEFAULT_SUITE.contexts.map(String)).map(Number),
    positions: list(flags, "positions", DEFAULT_SUITE.positions.map(String)).map(Number),
    casesPerCell: numOpt(flags, "cases") ?? DEFAULT_SUITE.casesPerCell,
    seed: numOpt(flags, "seed") ?? DEFAULT_SUITE.seed,
  };
}

function progress(name: string): (done: number, total: number) => void {
  return (done, total) => {
    const width = 24;
    const filled = Math.round((done / total) * width);
    const bar = "#".repeat(filled) + "-".repeat(width - filled);
    process.stdout.write(`  ${name.padEnd(20)} [${bar}] ${done}/${total}\r`);
  };
}

interface Flags {
  _: string[];
  [k: string]: string | boolean | string[];
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const body = a.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[body] = args[++i];
      } else {
        flags[body] = true;
      }
    } else {
      (flags._ as string[]).push(a);
    }
  }
  return flags;
}

function str(flags: Flags, key: string, dflt: string): string {
  const v = flags[key];
  return typeof v === "string" ? v : dflt;
}
function strOpt(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}
function numOpt(flags: Flags, key: string): number | undefined {
  const v = flags[key];
  return typeof v === "string" ? Number(v) : undefined;
}
function list(flags: Flags, key: string, dflt: string[]): string[] {
  const v = flags[key];
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return dflt;
}
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}
function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "." : p.slice(0, i);
}

function printHelp(): void {
  console.log(`lcbench — mini long-context understanding benchmark

Usage:
  lcbench demo [--out DIR] [--models a,b,c] [suite flags]
  lcbench bench --model SPEC [--out FILE] [--thinking LEVEL] [suite flags]
  lcbench generate --out DIR [suite flags]
  lcbench run --dataset DIR --model SPEC [--out FILE] [--concurrency N]
  lcbench report --results a.jsonl,b.jsonl

Provider SPEC:
  mock:oracle | mock:naive | mock:degrading
  gemini:<model>     (env GEMINI_API_KEY or GOOGLE_API_KEY)
  openai:<model>     (env OPENAI_API_KEY, optional OPENAI_API_BASE)
  anthropic:<model>  (env ANTHROPIC_API_KEY)
  cursor:<model>     (env CURSOR_API_KEY, optional CURSOR_API_BASE)
                     default model cursor-grok-4.6; OpenAI-compatible

Suite flags (all optional):
  --types superseded,distractor,positional,multihop
  --contexts 8000,32000,128000,512000
  --positions 0.05,0.25,0.5,0.75,0.95
  --cases 3            cases per (type,context,position) cell
  --seed 42

Examples:
  lcbench demo
  lcbench bench --model gemini:gemini-2.0-flash --thinking medium
  lcbench bench --model cursor:cursor-grok-4.6
  lcbench generate --out datasets --contexts 32000,256000
  lcbench run --dataset datasets --model openai:gpt-4o-mini
`);
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
