/**
 * Dataset generator.
 *
 * Produces synthetic "project history" contexts sized to a target token budget and
 * injects one decisive test into each, at a controlled position. The domain (a
 * clinic/appointment booking backend) mirrors the kind of long-horizon software
 * project where a model must reconstruct *current* world-state from a long history
 * of decisions, reversals, and scope-limited exceptions.
 *
 * Each generated case carries a machine-checkable ground truth, so scoring never
 * needs a network call or an LLM judge.
 */

import { Rng } from "./rng.js";
import { estimateTokens, charsForTokens } from "./tokens.js";
import type { BenchCase, CaseType, GroundTruth } from "./types.js";

export interface GenerateOptions {
  type: CaseType;
  contextTokens: number;
  importantFactPosition: number; // 0..1
  seed: number;
}

interface Injection {
  position: number; // 0..1
  text: string;
}

/** Public entry: build a single case. */
export function generateCase(opts: GenerateOptions): BenchCase {
  const rng = new Rng(opts.seed);
  switch (opts.type) {
    case "superseded":
      return buildSuperseded(opts, rng);
    case "distractor":
      return buildDistractor(opts, rng);
    case "positional":
      return buildPositional(opts, rng);
    case "multihop":
      return buildMultihop(opts, rng);
    default: {
      const _exhaustive: never = opts.type;
      throw new Error(`unknown case type: ${_exhaustive}`);
    }
  }
}

// --------------------------------------------------------------------------
// Case builders
// --------------------------------------------------------------------------

function buildSuperseded(opts: GenerateOptions, rng: Rng): BenchCase {
  // A single knob (cancellation timeout) is decided several times; only the last
  // decision is current. Distinct values so leakage is unambiguous.
  const values = uniqueInts(rng, 4, [10, 15, 20, 25, 30, 40, 45, 60, 90]);
  const finalValue = values[values.length - 1];
  const superseded = values.slice(0, -1).map((v) => `${v}`);

  const decisions = [
    `Initial spec: appointment cancellation timeout = ${values[0]} minutes.`,
    `Update: for BOGO appointments, cancellation timeout = ${values[1]} minutes.`,
    `Architecture review: the UTC+9 exception was rejected; BOGO stays uniform.`,
    `Revision: BOGO cancellation timeout changed to ${values[2]} minutes for all clinics.`,
    `FINAL DECISION (supersedes all earlier values): BOGO appointment cancellation timeout = ${finalValue} minutes.`,
  ];

  // Spread the decisions across the context; the FINAL one lands at the requested
  // position so we can study positional sensitivity of the decisive statement.
  const injections = spreadDecisions(decisions, opts.importantFactPosition);

  const context = assembleContext(opts.contextTokens, injections, rng);
  const gt: GroundTruth = {
    finalAnswer: `${finalValue} minutes`,
    answerValue: finalValue,
    supersededValues: superseded,
    constraints: [],
  };

  return finalize(opts, context, superSededQuestion(), gt);
}

function buildDistractor(opts: GenerateOptions, rng: Rng): BenchCase {
  // Many semantically-adjacent knobs, each changed a couple of times. The model
  // must select the right entity AND its final version.
  const entities = [
    { key: "appointmentTimeout", unit: "s" },
    { key: "appointmentQueueTimeout", unit: "s" },
    { key: "appointmentCancellationTimeout", unit: "m" },
    { key: "doctorScheduleCacheTTL", unit: "m" },
    { key: "pendingAppointmentTTL", unit: "m" },
  ];
  const target = rng.pick(entities);

  const lines: string[] = [];
  let targetFinal = 0;
  const targetSuperseded: string[] = [];

  for (const e of entities) {
    const vals = uniqueInts(rng, 3, [10, 15, 20, 25, 30, 35, 40, 45, 50, 60]);
    vals.forEach((v, i) => {
      const tag = i === vals.length - 1 ? "FINAL" : "superseded";
      lines.push(`${tag}: ${e.key} = ${v}${e.unit}`);
    });
    if (e.key === target.key) {
      targetFinal = vals[vals.length - 1];
      targetSuperseded.push(...vals.slice(0, -1).map((v) => `${v}${target.unit}`));
    }
  }
  // Shuffle so the target's lines are not conveniently grouped.
  shuffle(lines, rng);

  // The target's FINAL line is the decisive fact; place it at the requested position.
  const decisiveLine = `FINAL: ${target.key} = ${targetFinal}${target.unit}`;
  const others = lines.filter((l) => l !== decisiveLine);
  const injections: Injection[] = [
    { position: opts.importantFactPosition, text: decisiveLine },
    ...others.map((l, i) => ({
      position: (i + 1) / (others.length + 2),
      text: l,
    })),
  ];

  const context = assembleContext(opts.contextTokens, injections, rng);
  const gt: GroundTruth = {
    finalAnswer: `${targetFinal}${target.unit}`,
    answerValue: targetFinal,
    supersededValues: targetSuperseded,
    constraints: [],
  };

  const question =
    `According to the FINAL project state, what is the value of ` +
    `\`${target.key}\`? Answer with the exact value including its unit ` +
    `(e.g. "30m" or "30s").`;
  return finalize(opts, context, question, gt);
}

function buildPositional(opts: GenerateOptions, rng: Rng): BenchCase {
  // A single security rule is decisive. Obsolete "use API keys" chatter is sprinkled
  // as distraction; only the final rule at the target position is correct.
  const rule =
    `FINAL SECURITY RULE: internal service-to-service authentication MUST use ` +
    `workload identity. Static API keys MUST NOT be used in the request path.`;

  const obsolete = [
    `(2024) legacy note: services authenticate with a shared API key header.`,
    `TODO(old): rotate the static API key monthly.`,
    `deprecated: X-Service-Api-Key was used before the identity migration.`,
  ];
  const injections: Injection[] = [
    { position: opts.importantFactPosition, text: rule },
    ...obsolete.map((t, i) => ({ position: (i + 1) / (obsolete.length + 2), text: t })),
  ];

  const context = assembleContext(opts.contextTokens, injections, rng);
  const gt: GroundTruth = {
    finalAnswer: "workload identity",
    supersededValues: ["api key", "api keys", "static api key"],
    // Using an API key here is an architectural constraint violation, not just leakage.
    constraints: ["api key", "api-key", "api_key", "apikey"],
  };

  const question =
    `You are generating the internal service authentication config. According to ` +
    `the FINAL security decision in this project, which authentication mechanism ` +
    `must be used? Answer with the mechanism name only.`;
  return finalize(opts, context, question, gt);
}

function buildMultihop(opts: GenerateOptions, rng: Rng): BenchCase {
  // The answer (a timeout) is never written literally; it must be integrated from
  // a chain of independent facts scattered across the context.
  const base = rng.pick([10, 15, 20, 25, 30]);
  const multiplier = rng.pick([2, 3]);
  const answer = base * multiplier;
  const oldName = rng.pick(["KBY", "ZTA", "QRN", "LMP"]);
  const newName = rng.pick(["KBM", "ZTX", "QRS", "LMR"]);

  const facts = [
    `Premium clinics use Policy B; all other clinics use Policy A.`,
    `Clinic ${oldName} was upgraded to Premium tier this quarter.`,
    `Policy B means reservations remain valid ${multiplier}x as long as Policy A.`,
    `Policy A reservation timeout = ${base} minutes.`,
    `Clinic ${oldName} was renamed to ${newName}; its clinic identity is unchanged.`,
  ];
  // Deterministically order the facts across the context; the LAST-needed fact
  // (the base value) sits at the requested position.
  const injections = spreadDecisions(facts, opts.importantFactPosition);

  const context = assembleContext(opts.contextTokens, injections, rng);
  const gt: GroundTruth = {
    finalAnswer: `${answer} minutes`,
    answerValue: answer,
    supersededValues: [],
    constraints: [],
    hopChain: [
      `${newName} == formerly ${oldName}`,
      `${oldName} -> Premium`,
      `Premium -> Policy B`,
      `Policy B -> ${multiplier}x Policy A`,
      `Policy A -> ${base} minutes`,
      `${base} x ${multiplier} = ${answer} minutes`,
    ],
  };

  const question =
    `What reservation timeout (in minutes) should an appointment at clinic ` +
    `${newName} use, according to the current project state? Answer with the number.`;
  return finalize(opts, context, question, gt);
}

// --------------------------------------------------------------------------
// Shared helpers
// --------------------------------------------------------------------------

function superSededQuestion(): string {
  return (
    `According to the FINAL architecture decisions in this project, what ` +
    `cancellation timeout applies to a BOGO appointment? Answer with the number ` +
    `of minutes.`
  );
}

function finalize(
  opts: GenerateOptions,
  context: string,
  question: string,
  gt: GroundTruth,
): BenchCase {
  return {
    id: `${opts.type}-${opts.contextTokens}-p${Math.round(
      opts.importantFactPosition * 100,
    )}-s${opts.seed}`,
    type: opts.type,
    targetTokens: opts.contextTokens,
    contextTokens: estimateTokens(context),
    importantFactPosition: opts.importantFactPosition,
    context,
    question,
    groundTruth: gt,
    seed: opts.seed,
  };
}

/** Spread decisive statements evenly, pinning the LAST one at `finalPosition`. */
function spreadDecisions(decisions: string[], finalPosition: number): Injection[] {
  const n = decisions.length;
  return decisions.map((text, i) => {
    if (i === n - 1) return { position: finalPosition, text };
    // Earlier decisions occupy the first ~70% of the context, in order.
    const pos = ((i + 1) / (n + 1)) * Math.min(0.7, finalPosition + 0.001);
    return { position: pos, text };
  });
}

/**
 * Build a context of ~targetTokens by interleaving filler with injected facts.
 * Injections are placed when the running length crosses their fractional offset;
 * any not yet placed by the end are appended so nothing is dropped.
 */
function assembleContext(
  targetTokens: number,
  injectionsIn: Injection[],
  rng: Rng,
): string {
  const targetChars = charsForTokens(targetTokens);
  const injections = [...injectionsIn].sort((a, b) => a.position - b.position);
  const parts: string[] = [];
  let len = 0;
  let turn = 1;
  let injIdx = 0;

  const header = () =>
    `\n\n===== Turn ${turn++} | project: clinic-booking-svc =====\n`;

  const placeDue = () => {
    while (
      injIdx < injections.length &&
      len / targetChars >= injections[injIdx].position
    ) {
      const block = `${header()}[DECISION LOG]\n${injections[injIdx].text}\n`;
      parts.push(block);
      len += block.length;
      injIdx++;
    }
  };

  // Reserve a little headroom so appended injections don't massively overshoot.
  const fillTarget = targetChars * 0.98;
  while (len < fillTarget) {
    placeDue();
    const block = header() + fillerTurn(rng);
    parts.push(block);
    len += block.length;
  }
  // Place any remaining injections (e.g. position ~1.0).
  while (injIdx < injections.length) {
    const block = `${header()}[DECISION LOG]\n${injections[injIdx].text}\n`;
    parts.push(block);
    injIdx++;
  }

  return parts.join("").trimStart();
}

/** A chunk of plausible, non-decisive project noise (code, logs, discussion). */
function fillerTurn(rng: Rng): string {
  const kind = rng.int(0, 3);
  switch (kind) {
    case 0:
      return codeFiller(rng);
    case 1:
      return logFiller(rng);
    case 2:
      return discussionFiller(rng);
    default:
      return docFiller(rng);
  }
}

function codeFiller(rng: Rng): string {
  const fn = rng.pick([
    "resolveClinicSchedule",
    "buildAppointmentPayload",
    "normalizePatientRecord",
    "computeSlotAvailability",
    "serializeBookingEvent",
  ]);
  const lines = [
    `// module: services/${fn}.ts`,
    `export async function ${fn}(ctx: RequestContext) {`,
    `  const cfg = await ctx.config.load();`,
    `  const clinic = await ctx.repo.clinics.byId(ctx.params.clinicId);`,
    `  if (!clinic) throw new NotFoundError("clinic");`,
    `  const slots = await ctx.repo.slots.forClinic(clinic.id, ctx.window);`,
    `  return slots.filter((s) => s.status === "open").map(toDTO);`,
    `}`,
  ];
  const rep = rng.int(2, 6);
  return Array.from({ length: rep }, () => lines.join("\n")).join("\n\n") + "\n";
}

function logFiller(rng: Rng): string {
  const out: string[] = [];
  const rep = rng.int(6, 20);
  for (let i = 0; i < rep; i++) {
    const ms = rng.int(1, 900);
    const code = rng.pick([200, 200, 200, 201, 204, 400, 404, 500]);
    out.push(
      `2026-08-${rng.int(10, 28)}T${pad(rng.int(0, 23))}:${pad(
        rng.int(0, 59),
      )}:${pad(rng.int(0, 59))}Z level=info svc=booking route=/v1/appointments status=${code} dur=${ms}ms trace=${hex(rng)}`,
    );
  }
  return out.join("\n") + "\n";
}

function discussionFiller(rng: Rng): string {
  const topics = [
    "We debated whether to precompute availability per clinic or on demand.",
    "Someone raised that timezone handling for cross-region clinics is tricky.",
    "The payments team wants idempotency keys on every booking mutation.",
    "There was a tangent about renaming the pendingAppointment table.",
    "QA noted flakiness in the slot-locking integration test.",
    "We considered caching doctor schedules but worried about staleness.",
  ];
  const rep = rng.int(2, 5);
  return (
    Array.from({ length: rep }, () => rng.pick(topics)).join(" ") + "\n"
  );
}

function docFiller(rng: Rng): string {
  const rep = rng.int(2, 5);
  const paras = [
    "The booking service exposes a REST API for creating, listing, and cancelling appointments.",
    "Availability is derived from clinic operating hours minus already-booked slots.",
    "All timestamps are stored in UTC and converted at the presentation layer.",
    "Rate limiting is applied per API token using a sliding-window counter.",
    "Observability is provided via structured logs and OpenTelemetry traces.",
  ];
  return Array.from({ length: rep }, () => rng.pick(paras)).join(" ") + "\n";
}

// --------------------------------------------------------------------------
// small utilities
// --------------------------------------------------------------------------

function uniqueInts(rng: Rng, count: number, pool: number[]): number[] {
  const copy = [...pool];
  shuffle(copy, rng);
  return copy.slice(0, count);
}

function shuffle<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function hex(rng: Rng): string {
  return Array.from({ length: 8 }, () => rng.int(0, 15).toString(16)).join("");
}
