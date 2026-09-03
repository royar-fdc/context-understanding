/**
 * Anthropic Messages adapter. Reads ANTHROPIC_API_KEY.
 */

import type { Provider } from "../types.js";
import { HttpProviderConfig, postJson, requireEnv, timed } from "./http.js";

export function makeAnthropic(cfg: HttpProviderConfig): Provider {
  const model = cfg.model || "claude-3-5-haiku-latest";
  return {
    name: `anthropic:${model}`,
    async complete({ system, user }) {
      const key = requireEnv("ANTHROPIC_API_KEY");
      const url = "https://api.anthropic.com/v1/messages";
      const body = {
        model,
        max_tokens: cfg.maxTokens ?? 1024,
        temperature: cfg.temperature ?? 0,
        system,
        messages: [{ role: "user", content: user }],
      };
      return timed(async () => {
        const json = (await postJson(
          url,
          { "x-api-key": key, "anthropic-version": "2023-06-01" },
          body,
        )) as AnthropicResponse;
        const raw = json.content?.map((b) => b.text ?? "").join("") ?? "";
        return {
          raw,
          usage: {
            inputTokens: json.usage?.input_tokens,
            outputTokens: json.usage?.output_tokens,
          },
        };
      });
    },
  };
}

interface AnthropicResponse {
  content?: { type?: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}
