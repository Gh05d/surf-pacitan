import { describe, test, expect } from "bun:test";
import {
  parseClaudeEnvelope,
  extractJsonBlock,
  buildClaudeArgs,
  resolveClaudeBin,
} from "../src/server/claude-cli";

describe("parseClaudeEnvelope", () => {
  test("extracts result text, model and cost from the JSON envelope", () => {
    const envelope = JSON.stringify({
      result: '{"bestSpot":"pancer"}',
      total_cost_usd: 0.0123,
      modelUsage: { "claude-sonnet-4-6": { inputTokens: 100 } },
    });
    const parsed = parseClaudeEnvelope(envelope);
    expect(parsed.text).toBe('{"bestSpot":"pancer"}');
    expect(parsed.model).toBe("claude-sonnet-4-6");
    expect(parsed.costUsd).toBe(0.0123);
  });

  test("throws on is_error envelopes", () => {
    const envelope = JSON.stringify({ is_error: true, result: "usage limit reached" });
    expect(() => parseClaudeEnvelope(envelope)).toThrow("usage limit reached");
  });

  test("tolerates missing model/cost fields", () => {
    const parsed = parseClaudeEnvelope(JSON.stringify({ result: "hi" }));
    expect(parsed.model).toBeNull();
    expect(parsed.costUsd).toBeNull();
  });
});

describe("extractJsonBlock", () => {
  const obj = { bestSpot: "pancerDoor", bestWindow: { start: "06:00", end: "08:00" } };

  test("parses a raw JSON body", () => {
    expect(extractJsonBlock(JSON.stringify(obj))).toEqual(obj);
  });

  test("parses a ```json fenced block", () => {
    const text = "Here you go:\n```json\n" + JSON.stringify(obj) + "\n```\nEnjoy!";
    expect(extractJsonBlock(text)).toEqual(obj);
  });

  test("parses JSON embedded in prose", () => {
    const text = "The recommendation is " + JSON.stringify(obj) + " based on the data.";
    expect(extractJsonBlock(text)).toEqual(obj);
  });

  test("throws when no JSON is present", () => {
    expect(() => extractJsonBlock("no json here at all")).toThrow("No parseable JSON");
  });
});

describe("buildClaudeArgs", () => {
  test("builds a print-mode JSON invocation with neutral MCP config", () => {
    const args = buildClaudeArgs("sonnet");
    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--disable-slash-commands");
  });
});

describe("resolveClaudeBin", () => {
  test("CLAUDE_CLI_PATH override wins", () => {
    expect(resolveClaudeBin({ CLAUDE_CLI_PATH: "/opt/claude" })).toBe("/opt/claude");
  });

  test("falls back to bare name when nothing is found", () => {
    expect(resolveClaudeBin({ HOME: "/nonexistent-home-xyz" })).toBe("claude");
  });
});
