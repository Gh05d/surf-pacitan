/**
 * Claude CLI client (subscription, NOT the metered API).
 *
 * Adapted from the verified meme-scraper Don pattern
 * (/root/meme-scraper/src/don/claude-cli.ts, verified 2026-06-01):
 *  - `claude -p --output-format json` wraps the answer in an envelope; the
 *    model's text is the `result` field.
 *  - Subscription OAuth (~/.claude/.credentials.json) is used as long as
 *    ANTHROPIC_API_KEY is NOT set — we strip it from the child env to
 *    guarantee no metered API billing.
 *  - Context is minimised with a neutral cwd (no project CLAUDE.md), empty
 *    MCP config, and slash-commands disabled.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Resolve the absolute path to the `claude` CLI binary. The systemd service
 * runs with a minimal $PATH (no ~/.local/bin), so spawning by bare name can
 * fail with ENOENT. Resolution: CLAUDE_CLI_PATH env override → known
 * HOME-relative install locations → bare "claude".
 */
export function resolveClaudeBin(env: Record<string, string | undefined> = process.env): string {
  if (env.CLAUDE_CLI_PATH) return env.CLAUDE_CLI_PATH;
  const home = env.HOME ?? "/root";
  const candidates = [
    `${home}/.local/bin/claude`,
    `${home}/.bun/bin/claude`,
    "/usr/local/bin/claude",
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* ignore unreadable candidate */
    }
  }
  return "claude";
}

export interface ClaudeEnvelope {
  /** The model's answer (envelope `result` field). */
  text: string;
  /** Actual model id from the envelope (e.g. "claude-sonnet-4-6"), if present. */
  model: string | null;
  /** Theoretical cost reported by the CLI (drawn from the subscription, not billed). */
  costUsd: number | null;
}

/** Parse the `claude -p --output-format json` envelope. */
export function parseClaudeEnvelope(stdout: string): ClaudeEnvelope {
  const env = JSON.parse(stdout);
  if (env?.is_error) {
    throw new Error(`claude returned error: ${env.result ?? env.subtype ?? "unknown"}`);
  }
  const text = typeof env.result === "string" ? env.result : JSON.stringify(env.result);
  const model =
    env.modelUsage && typeof env.modelUsage === "object"
      ? (Object.keys(env.modelUsage)[0] ?? null)
      : null;
  return {
    text,
    model,
    costUsd: typeof env.total_cost_usd === "number" ? env.total_cost_usd : null,
  };
}

/** Build the claude CLI argv (exported for tests). */
export function buildClaudeArgs(model: string): string[] {
  return [
    "-p", "--output-format", "json", "--model", model,
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--disable-slash-commands",
  ];
}

/**
 * Extract a JSON value from free-text model output. Handles a clean JSON
 * body, a ```json fenced block, or JSON embedded in prose (first `{`/`[` to
 * its last matching `}`/`]`). Prefers an object (the recommendation schema is
 * an object).
 */
export function extractJsonBlock(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* not raw JSON — fall through */
  }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }

  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }

  throw new Error(`No parseable JSON found in model output (len=${text.length})`);
}

export interface ClaudeCliOptions {
  model: string;
  systemPrompt: string;
  userPayload: unknown;
  timeoutMs: number;
}

export interface ClaudeCliResult {
  /** Parsed JSON recommendation from the model output. */
  content: unknown;
  /** Actual model id from the envelope, if reported. */
  model: string | null;
}

/**
 * Run the recommendation prompt through the Claude CLI (subscription auth)
 * and return the parsed JSON answer. The prompt is piped via stdin (reliable
 * for large prompts).
 */
export async function callClaudeCli(opts: ClaudeCliOptions): Promise<ClaudeCliResult> {
  const prompt =
    `${opts.systemPrompt}\n\n# Forecast input\n` +
    `${JSON.stringify(opts.userPayload)}\n\n` +
    `Respond with ONLY the JSON object — no prose, no markdown fences.`;

  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.ANTHROPIC_API_KEY; // force subscription OAuth, never metered API
  env.HOME ??= "/root"; // systemd services may not set HOME; OAuth lives in ~/.claude

  const bin = resolveClaudeBin(env);
  if (bin.includes("/")) env.PATH = `${dirname(bin)}:${env.PATH ?? "/usr/bin:/bin"}`;

  const proc = Bun.spawn([bin, ...buildClaudeArgs(opts.model)], {
    cwd: "/tmp", // neutral: no project CLAUDE.md / skills loaded
    env,
    stdin: Buffer.from(prompt, "utf8"),
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, opts.timeoutMs);

  try {
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited; // CRITICAL: avoid zombie
    if (timedOut) throw new Error(`claude CLI timed out after ${opts.timeoutMs}ms`);
    if (exitCode !== 0) {
      throw new Error(`claude CLI exited ${exitCode}: ${stderr.slice(0, 500)}`);
    }
    const envelope = parseClaudeEnvelope(stdout);
    console.log(
      `[claude-cli] ${envelope.model ?? opts.model} responded — cost-equiv $${envelope.costUsd?.toFixed(4) ?? "?"} (subscription)`,
    );
    return { content: extractJsonBlock(envelope.text), model: envelope.model };
  } finally {
    clearTimeout(timer);
  }
}
