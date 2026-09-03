/**
 * OpenAI Chat Completions adapter. Reads OPENAI_API_KEY.
 */

import type { Provider } from "../types.js";
import type { HttpProviderConfig } from "./http.js";
import { makeOpenAICompatible } from "./openai-compatible.js";

export function makeOpenAI(cfg: HttpProviderConfig): Provider {
  return makeOpenAICompatible({
    label: "openai",
    model: cfg.model || "gpt-4o-mini",
    baseUrl: process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    temperature: cfg.temperature,
    jsonMode: true,
  });
}
