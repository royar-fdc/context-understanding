/**
 * Provider factory: turn a spec string into a runnable provider.
 *
 * Spec grammar:  <kind>[:<model>]
 *   mock:oracle | mock:naive | mock:degrading
 *   gemini:<model>        e.g. gemini:gemini-2.0-flash
 *   openai:<model>        e.g. openai:gpt-4o-mini
 *   anthropic:<model>     e.g. anthropic:claude-3-5-haiku-latest
 */

import type { Provider } from "../types.js";
import { makeAnthropic } from "./anthropic.js";
import { makeCursor } from "./cursor.js";
import { makeGemini } from "./gemini.js";
import { makeOpenAI } from "./openai.js";
import { isSimulator, makeDegrading, makeNaive, makeOracle, type Simulator } from "./mock.js";
import type { HttpProviderConfig } from "./http.js";

export type AnyProvider = Provider | Simulator;

export interface ProviderSpecOptions {
  temperature?: number;
  maxTokens?: number;
  thinking?: string;
}

export function createProvider(spec: string, opts: ProviderSpecOptions = {}): AnyProvider {
  const [kind, ...rest] = spec.split(":");
  const model = rest.join(":");
  const cfg: HttpProviderConfig = {
    model,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    thinking: opts.thinking,
  };

  switch (kind) {
    case "mock":
      return createMock(model);
    case "gemini":
      return makeGemini(cfg);
    case "openai":
      return makeOpenAI(cfg);
    case "anthropic":
      return makeAnthropic(cfg);
    case "cursor":
      return makeCursor(cfg);
    default:
      throw new Error(
        `Unknown provider kind "${kind}". Expected mock|gemini|openai|anthropic|cursor.`,
      );
  }
}

function createMock(behavior: string): Simulator {
  switch (behavior) {
    case "oracle":
      return makeOracle();
    case "naive":
      return makeNaive();
    case "":
    case "degrading":
      return makeDegrading();
    default:
      throw new Error(
        `Unknown mock behavior "${behavior}". Expected oracle|naive|degrading.`,
      );
  }
}

export { isSimulator };
export type { Simulator };
