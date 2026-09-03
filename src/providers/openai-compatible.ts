/**
 * Shared client for any endpoint that speaks the OpenAI Chat Completions wire
 * format (`POST {base}/chat/completions` with `messages`, returning
 * `choices[0].message.content`). Used by the OpenAI and Cursor providers.
 */

import type { Provider } from "../types.js";
import { postJson, requireEnv, timed } from "./http.js";

export interface OpenAICompatibleOptions {
  /** Provider display name prefix, e.g. "openai" or "cursor". */
  label: string;
  /** Model id to send. */
  model: string;
  /** Base URL including version path, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  /** Env var holding the API key. */
  apiKeyEnv: string;
  /** Fallback env var for the API key (optional). */
  apiKeyEnvFallback?: string;
  temperature?: number;
  /** Send response_format: json_object (some gateways reject it). */
  jsonMode?: boolean;
  /** Extra headers to send (e.g. anthropic-version, HTTP-Referer). */
  headers?: Record<string, string>;
}

export function makeOpenAICompatible(opts: OpenAICompatibleOptions): Provider {
  const base = opts.baseUrl.replace(/\/+$/, "");
  return {
    name: `${opts.label}:${opts.model}`,
    async complete({ system, user }) {
      const key = opts.apiKeyEnvFallback
        ? process.env[opts.apiKeyEnv] ?? requireEnv(opts.apiKeyEnvFallback)
        : requireEnv(opts.apiKeyEnv);
      const url = `${base}/chat/completions`;
      const body: Record<string, unknown> = {
        model: opts.model,
        temperature: opts.temperature ?? 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      };
      if (opts.jsonMode) body.response_format = { type: "json_object" };

      return timed(async () => {
        const json = (await postJson(
          url,
          { authorization: `Bearer ${key}`, ...opts.headers },
          body,
        )) as OpenAIChatResponse;
        const raw = json.choices?.[0]?.message?.content ?? "";
        return {
          raw,
          usage: {
            inputTokens: json.usage?.prompt_tokens,
            outputTokens: json.usage?.completion_tokens,
          },
        };
      });
    },
  };
}

interface OpenAIChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
