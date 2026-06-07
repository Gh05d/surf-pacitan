import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { callDeepSeek, DeepSeekError } from "../src/server/deepseek";

interface FetchCallSnapshot {
  url: string;
  init: RequestInit;
}

const calls: FetchCallSnapshot[] = [];
let mockResponse: { status: number; body: any } = { status: 200, body: {} };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls.length = 0;
  mockResponse = { status: 200, body: {} };
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(mockResponse.body), { status: mockResponse.status });
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function okResponseWith(content: object) {
  return {
    id: "chatcmpl-x",
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
}

describe("callDeepSeek", () => {
  test("POSTs to the configured URL with bearer token", async () => {
    mockResponse = { status: 200, body: okResponseWith({ ok: true }) };
    await callDeepSeek({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      systemPrompt: "you are helpful",
      userPayload: { hello: "world" },
      thinking: true,
      timeoutMs: 5000,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("sends the right body shape", async () => {
    mockResponse = { status: 200, body: okResponseWith({ ok: true }) };
    await callDeepSeek({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      systemPrompt: "sys",
      userPayload: { hello: "world" },
      thinking: true,
      timeoutMs: 5000,
    });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(JSON.parse(body.messages[1].content)).toEqual({ hello: "world" });
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  test("sends max_tokens 8000 so thinking + answer fit the shared budget", async () => {
    mockResponse = { status: 200, body: okResponseWith({ ok: true }) };
    await callDeepSeek({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      systemPrompt: "sys",
      userPayload: {},
      thinking: true,
      timeoutMs: 5000,
    });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.max_tokens).toBe(8000);
  });

  test("returns the parsed JSON content from message", async () => {
    mockResponse = { status: 200, body: okResponseWith({ pick: "pancer" }) };
    const result = await callDeepSeek({
      apiKey: "sk-test",
      model: "deepseek-v4-flash",
      systemPrompt: "sys",
      userPayload: {},
      thinking: true,
      timeoutMs: 5000,
    });
    expect(result.content).toEqual({ pick: "pancer" });
    expect(result.usage.total_tokens).toBe(150);
  });

  test("throws DeepSeekError on non-2xx response", async () => {
    mockResponse = { status: 429, body: { error: "rate limited" } };
    try {
      await callDeepSeek({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        systemPrompt: "sys",
        userPayload: {},
        thinking: true,
        timeoutMs: 5000,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeepSeekError);
      expect((err as DeepSeekError).status).toBe(429);
    }
  });

  test("throws DeepSeekError if message content is not parseable JSON", async () => {
    mockResponse = {
      status: 200,
      body: { choices: [{ message: { content: "not json!" } }], usage: { total_tokens: 0 } },
    };
    try {
      await callDeepSeek({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        systemPrompt: "sys",
        userPayload: {},
        thinking: true,
        timeoutMs: 5000,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeepSeekError);
      expect((err as DeepSeekError).reason).toBe("parse");
    }
  });

  // 2026-06-07 incident: thinking mode shares max_tokens with the final answer.
  // When reasoning overruns the budget, the API returns HTTP 200 with
  // finish_reason "length" and an EMPTY content string. That must surface as a
  // distinct truncation error, not a generic "not valid JSON" parse error.
  test("throws a truncation error when content is empty with finish_reason length", async () => {
    mockResponse = {
      status: 200,
      body: {
        choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "long thoughts…" } }],
        usage: { prompt_tokens: 3564, completion_tokens: 4000, total_tokens: 7564 },
      },
    };
    try {
      await callDeepSeek({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        systemPrompt: "sys",
        userPayload: {},
        thinking: true,
        timeoutMs: 5000,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeepSeekError);
      expect((err as DeepSeekError).reason).toBe("truncated");
      expect((err as DeepSeekError).message).toContain("max_tokens");
    }
  });

  test("aborts with a timeout error when the response body stalls past timeoutMs", async () => {
    // fetch resolves on headers; DeepSeek streams keep-alive bytes while thinking,
    // so the body read is the slow path (40s observed 2026-06-07). The abort must
    // stay armed until the body is fully read.
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal | undefined;
      const stream = new ReadableStream({
        start(controller) {
          const t = setTimeout(() => {
            controller.enqueue(new TextEncoder().encode("{}"));
            controller.close();
          }, 200);
          signal?.addEventListener("abort", () => {
            clearTimeout(t);
            controller.error(new DOMException("aborted", "AbortError"));
          });
        },
      });
      return new Response(stream, { status: 200 });
    }) as any;
    try {
      await callDeepSeek({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        systemPrompt: "sys",
        userPayload: {},
        thinking: true,
        timeoutMs: 20,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeepSeekError);
      expect((err as DeepSeekError).reason).toBe("timeout");
    }
  });

  test("throws DeepSeekError if choices array is missing", async () => {
    mockResponse = { status: 200, body: { id: "x" } };
    try {
      await callDeepSeek({
        apiKey: "sk-test",
        model: "deepseek-v4-flash",
        systemPrompt: "sys",
        userPayload: {},
        thinking: true,
        timeoutMs: 5000,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DeepSeekError);
    }
  });
});
