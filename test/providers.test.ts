import { afterEach, describe, expect, it, vi } from "vitest";
import { createProvider, isSimulator } from "../src/providers/index";
import type { Provider } from "../src/types";

describe("provider factory", () => {
  it("creates mock simulators", () => {
    expect(isSimulator(createProvider("mock:oracle"))).toBe(true);
    expect(isSimulator(createProvider("mock:naive"))).toBe(true);
    expect(isSimulator(createProvider("mock:degrading"))).toBe(true);
  });

  it("creates the cursor provider with the grok default model", () => {
    const p = createProvider("cursor") as Provider;
    expect(isSimulator(p)).toBe(false);
    expect(p.name).toBe("cursor:cursor-grok-4.6");
  });

  it("honors an explicit cursor model", () => {
    const p = createProvider("cursor:cursor-grok-4.6") as Provider;
    expect(p.name).toBe("cursor:cursor-grok-4.6");
  });

  it("rejects unknown provider kinds", () => {
    expect(() => createProvider("nope:x")).toThrow(/Unknown provider kind/);
  });
});

describe("cursor provider request shaping", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_BASE;
  });

  it("posts OpenAI-compatible chat completions with Bearer auth to the cursor base url", async () => {
    process.env.CURSOR_API_KEY = "crsr_test_key";
    process.env.CURSOR_API_BASE = "https://gateway.example.com/v1";
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"final_answer":"30 minutes","superseded_rules":[],"evidence":[]}',
              },
            },
          ],
          usage: { prompt_tokens: 123, completion_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const p = createProvider("cursor:cursor-grok-4.6") as Provider;
    const res = await p.complete({ system: "sys", user: "usr" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gateway.example.com/v1/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer crsr_test_key");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe("cursor-grok-4.6");
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.messages[1]).toEqual({ role: "user", content: "usr" });
    expect(res.parsed?.final_answer).toBe("30 minutes");
    expect(res.usage?.inputTokens).toBe(123);
  });

  it("throws a helpful error when CURSOR_API_KEY is missing", async () => {
    const p = createProvider("cursor") as Provider;
    await expect(p.complete({ system: "s", user: "u" })).rejects.toThrow(/CURSOR_API_KEY/);
  });
});
