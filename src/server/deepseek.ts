import { DEEPSEEK_API_URL } from "./config";

export interface DeepSeekUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface DeepSeekResult {
  content: unknown;          // parsed JSON from message.content
  usage: DeepSeekUsage;
}

export interface DeepSeekOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPayload: unknown;
  thinking: boolean;
  timeoutMs: number;
}

export class DeepSeekError extends Error {
  constructor(
    message: string,
    public readonly reason: "http" | "parse" | "shape" | "timeout",
    public readonly status?: number,
    public readonly bodyExcerpt?: string,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

// NOTE: DeepSeek V4 thinking-mode parameter name is "thinking" at time of writing.
// V3 used "enable_thinking". If V4 rejects the request shape, check the live API
// response body for hints (it usually echoes the offending field) and adjust here.
export async function callDeepSeek(opts: DeepSeekOptions): Promise<DeepSeekResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: JSON.stringify(opts.userPayload) },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
    max_tokens: 4000,
  };
  if (opts.thinking) {
    body.thinking = { type: "enabled" };
  }

  let response: Response;
  try {
    response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      throw new DeepSeekError("DeepSeek request timed out", "timeout");
    }
    throw new DeepSeekError(`DeepSeek fetch failed: ${(err as Error).message}`, "http");
  }
  clearTimeout(timeout);

  const text = await response.text();

  if (!response.ok) {
    throw new DeepSeekError(
      `DeepSeek HTTP ${response.status}`,
      "http",
      response.status,
      text.slice(0, 500),
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DeepSeekError("DeepSeek response not JSON", "parse", response.status, text.slice(0, 500));
  }

  const message = parsed?.choices?.[0]?.message?.content;
  if (typeof message !== "string") {
    throw new DeepSeekError("DeepSeek response missing choices[0].message.content", "shape", response.status, text.slice(0, 500));
  }

  let content: unknown;
  try {
    content = JSON.parse(message);
  } catch {
    throw new DeepSeekError("DeepSeek message.content not valid JSON", "parse", response.status, message.slice(0, 500));
  }

  const usage: DeepSeekUsage = parsed.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  return { content, usage };
}
