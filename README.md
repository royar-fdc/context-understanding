# Context Understanding — mini long-context benchmark runner

A small, dependency-light benchmark runner that measures whether an LLM actually
**understands** a long context, not just whether it can **retrieve** a needle from
it. It generates synthetic "project history" contexts (8k → ~1M tokens), injects
decisions that get superseded, semantically-similar distractors, and multi-hop
dependencies, fires them at a model over its raw API (no editor/agent harness in
the way), and scores state accuracy, obsolete-context leakage, and multi-hop
integration.

This is the "raw API, no terminal" runner described in the design discussion: keep
the harness thin so results are attributable to the model, then (optionally)
compare against terminal coding agents as a separate experiment.

## Why not needle-in-a-haystack?

A needle test only exercises:

```
all context -> find X
```

Continuing a large, existing project requires much more:

```
all context -> find relevant info -> resolve contradictions -> determine
chronology -> understand scope -> discard superseded decisions ->
reconstruct current state -> reason over current state
```

The failure mode people describe as *"the model is great at new projects but gets
worse as the project grows"* is exactly this state-reconstruction problem. This
runner targets it directly.

## The four case types

| Type | What it stresses | Correct only if the model… |
| --- | --- | --- |
| `superseded` | chronology / contradiction resolution | uses the FINAL decision (A→B→C), not an earlier one |
| `distractor` | semantic collision | picks the right entity **and** its right version among look-alikes |
| `positional` | lost-in-the-middle + a hard constraint | applies the decisive rule regardless of where it sits (5%…95%) |
| `multihop` | integration | chains independent facts to an answer that is **never written literally** |

Every case ships with a machine-checkable ground truth, so scoring is deterministic
and offline (no LLM judge, no network).

## Metrics

- `state_accuracy` — is the final answer the current (final) one?
- `obsolete_rule_leakage` — did the answer reuse a superseded value?
- `integration_accuracy` — multi-hop answer correct? (multihop only)
- `constraint_violation` — did the answer break a stated hard constraint (e.g. use a forbidden mechanism)?
- `parse_rate` — did the model return the required JSON contract?

## Install

```bash
npm ci        # or: npm install
npm test      # 29 tests
npm run build # emit dist/
```

Requires Node ≥ 20 (uses the built-in `fetch`).

## Quick start (offline, no API keys)

```bash
npm run demo
# or
npx tsx src/cli.ts demo
```

The demo runs the full suite against three **mock** models and prints a report:

- `mock:oracle` — always answers from the final state → 100% / 0% leakage.
- `mock:naive` — anchors on the earliest decision → 0% state / high leakage.
- `mock:degrading` — correctness falls with context length and dips in the middle,
  reproducing the long-context degradation curve.

Example (excerpt) for `mock:degrading`:

```
By context length:
  context    | n   | parse | state | leak  | integ | violate
  8k         |  60 | 100% |  90% |   8% |  93% |   2%
  32k        |  60 | 100% |  73% |  18% |  67% |   7%
  128k       |  60 | 100% |  60% |  28% |  53% |   8%
  512k       |  60 | 100% |  48% |  37% |  40% |  10%
```

## Running against a real model

Set the relevant key (env var or Cloud Agent secret), then:

```bash
# Cursor (default model cursor-grok-4.6)
CURSOR_API_KEY=... npx tsx src/cli.ts bench --model cursor:cursor-grok-4.6

# Google Gemini
GEMINI_API_KEY=... npx tsx src/cli.ts bench --model gemini:gemini-2.0-flash --thinking medium

# OpenAI
OPENAI_API_KEY=... npx tsx src/cli.ts bench --model openai:gpt-4o-mini

# Anthropic
ANTHROPIC_API_KEY=... npx tsx src/cli.ts bench --model anthropic:claude-3-5-haiku-latest
```

Use a small matrix first to keep token usage/cost in check:

```bash
npx tsx src/cli.ts bench --model cursor:cursor-grok-4.6 \
  --contexts 8000,32000,128000 --positions 0.1,0.5,0.9 --cases 2 --out results.jsonl
```

### The Cursor provider (important)

As of this writing, **Cursor does not publish a standalone OpenAI-compatible
chat-completions inference API**. The Cursor API key (`crsr_...`) officially
authenticates the [Cloud Agents API](https://cursor.com/docs/api) and SDKs, which
are agentic and repository-oriented — not a raw model endpoint. A community request
for an OpenAI-compatible endpoint is still open.

So the `cursor` provider here speaks the standard OpenAI chat-completions wire
format against a **configurable** base URL:

| Env var | Default | Purpose |
| --- | --- | --- |
| `CURSOR_API_KEY` | — | your Cursor key (sent as `Authorization: Bearer`) |
| `CURSOR_API_BASE` | `https://api.cursor.com/v1` | base URL incl. version path |
| `CURSOR_JSON_MODE` | off | set to `1` to send `response_format=json_object` |

Point `CURSOR_API_BASE` at any OpenAI-compatible gateway that accepts your Cursor
key and exposes `cursor-grok-4.6`. If/when Cursor ships an official
chat-completions endpoint, the default base URL will work directly.

## Datasets on disk (reproducible, shareable)

```bash
# Write context/question/ground-truth files per case:
npx tsx src/cli.ts generate --out datasets --contexts 32000,256000

# Run any model over the saved dataset:
CURSOR_API_KEY=... npx tsx src/cli.ts run --dataset datasets --model cursor:cursor-grok-4.6

# Aggregate one or more result files into a report:
npx tsx src/cli.ts report --results results/cursor_cursor-grok-4.6.jsonl
```

Datasets use the layout from the design note:

```
datasets/
  <case-id>/
    context.md
    question.md
    ground-truth.json
    meta.json
  index.json
```

## Suite flags

```
--types      superseded,distractor,positional,multihop
--contexts   8000,32000,128000,512000
--positions  0.05,0.25,0.5,0.75,0.95     (fraction where the decisive fact sits)
--cases      3                            (independent seeds per cell)
--seed       42
```

Cells use **independent seeds** (distinct problem instances), not one prompt
repeated, so a lucky/unlucky single dataset cannot dominate the score.

## Output contract

Each model must return a single JSON object:

```json
{ "final_answer": "…", "superseded_rules": ["…"], "evidence": ["…"] }
```

The parser is tolerant (handles code fences and surrounding prose), and scoring is
unit-aware (e.g. `30s` is never accepted for a `30 minutes` answer).

## Project layout

```
src/
  generator.ts        synthetic context + ground-truth generation
  tokens.ts           approximate token sizing
  rng.ts              seeded PRNG (reproducibility)
  prompt.ts           minimal system prompt + JSON contract
  scorer.ts           deterministic, offline scoring
  report.ts           aggregation + text tables (by context / position / type)
  runner.ts           concurrency-limited execution
  suite.ts            matrix expansion
  cli.ts              demo | bench | generate | run | report
  providers/
    index.ts          spec -> provider factory
    mock.ts           oracle | naive | degrading simulators
    openai-compatible.ts   shared OpenAI wire-format client
    cursor.ts openai.ts gemini.ts anthropic.ts
    parse.ts          robust JSON extraction
test/                 vitest unit + end-to-end tests
```

## License

MIT
