/**
 * Shared helpers for the real (network) providers.
 */

import type { ModelAnswer, Provider, ProviderResult } from "../types.js";
import { parseModelAnswer } from "./parse.js";

export interface HttpProviderConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Gemini thinking level (low | medium | high), best-effort passthrough. */
  thinking?: string;
}

export async function timed(fn: () => Promise<{ raw: string; usage?: ProviderResult["usage"] }>): Promise<ProviderResult> {
  const start = Date.now();
  const { raw, usage } = await fn();
  const parsed: ModelAnswer | null = parseModelAnswer(raw);
  return { raw, parsed, usage, latencyMs: Date.now() - start };
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it (e.g. in a .env or as a Cloud Agent secret) to use this provider.`,
    );
  }
  return v;
}

export async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

export type ProviderFactory = (cfg: HttpProviderConfig) => Provider;
