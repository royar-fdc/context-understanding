/**
 * Cursor provider.
 *
 * IMPORTANT: As of this writing, Cursor does not publish a standalone
 * OpenAI-compatible chat-completions inference API. The Cursor API key
 * (`crsr_...`) officially authenticates the Cloud Agents API and SDKs, which are
 * agentic and repository-oriented rather than a raw model endpoint
 * (see https://cursor.com/docs/api).
 *
 * This provider therefore speaks the standard OpenAI Chat Completions wire format
 * against a configurable base URL:
 *
 *   - CURSOR_API_KEY   : your Cursor key (Bearer auth).
 *   - CURSOR_API_BASE  : base URL incl. version path.
 *                        Default: https://api.cursor.com/v1
 *   - CURSOR_JSON_MODE : set to "1" to send response_format=json_object.
 *
 * Point CURSOR_API_BASE at any OpenAI-compatible gateway that accepts your Cursor
 * key and exposes `cursor-grok-4.6`. If/when Cursor ships an official
 * chat-completions endpoint, the default base URL will work directly.
 *
 * We omit response_format by default because not all gateways accept it; the
 * strict JSON instruction in the system prompt plus the robust parser make the
 * output contract reliable regardless.
 */

import type { Provider } from "../types.js";
import type { HttpProviderConfig } from "./http.js";
import { makeOpenAICompatible } from "./openai-compatible.js";

export function makeCursor(cfg: HttpProviderConfig): Provider {
  return makeOpenAICompatible({
    label: "cursor",
    model: cfg.model || "cursor-grok-4.6",
    baseUrl: process.env.CURSOR_API_BASE ?? "https://api.cursor.com/v1",
    apiKeyEnv: "CURSOR_API_KEY",
    temperature: cfg.temperature,
    jsonMode: process.env.CURSOR_JSON_MODE === "1",
  });
}
