/**
 * Google Gemini adapter (Generative Language API).
 *
 * Reads GEMINI_API_KEY (falls back to GOOGLE_API_KEY). The thinking level is passed
 * through generationConfig when provided; the API tolerates omission.
 */

import type { Provider } from "../types.js";
import { HttpProviderConfig, postJson, requireEnv, timed } from "./http.js";

export function makeGemini(cfg: HttpProviderConfig): Provider {
  const model = cfg.model || "gemini-2.0-flash";
  return {
    name: `gemini:${model}`,
    async complete({ system, user }) {
      const key = process.env.GEMINI_API_KEY ?? requireEnv("GOOGLE_API_KEY");
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const generationConfig: Record<string, unknown> = {
        temperature: cfg.temperature ?? 0,
        responseMimeType: "application/json",
      };
      if (cfg.thinking) {
        generationConfig.thinkingConfig = { thinkingLevel: cfg.thinking.toUpperCase() };
      }
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig,
      };
      return timed(async () => {
        const json = (await postJson(url, {}, body)) as GeminiResponse;
        const raw =
          json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        return {
          raw,
          usage: {
            inputTokens: json.usageMetadata?.promptTokenCount,
            outputTokens: json.usageMetadata?.candidatesTokenCount,
          },
        };
      });
    },
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
