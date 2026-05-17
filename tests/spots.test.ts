import { describe, test, expect } from "bun:test";
import { SPOT_DISPLAY } from "../src/shared/spots";
import type { SpotName } from "../src/shared/types";

describe("SPOT_DISPLAY", () => {
  test("has exactly three spots", () => {
    expect(SPOT_DISPLAY).toHaveLength(3);
  });

  test("covers all SpotName keys", () => {
    const keys = SPOT_DISPLAY.map((s) => s.key);
    const expected: SpotName[] = ["pancer", "pancerDoor", "telengRia"];
    for (const k of expected) {
      expect(keys).toContain(k);
    }
  });

  test("ordering is west-to-east (Pancer, Pancer Door, Teleng Ria)", () => {
    expect(SPOT_DISPLAY[0].key).toBe("pancer");
    expect(SPOT_DISPLAY[1].key).toBe("pancerDoor");
    expect(SPOT_DISPLAY[2].key).toBe("telengRia");
  });

  test("each spot has non-empty label, abbr, emoji", () => {
    for (const s of SPOT_DISPLAY) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.abbr.length).toBeGreaterThan(0);
      expect(s.emoji.length).toBeGreaterThan(0);
    }
  });

  test("abbreviations are unique", () => {
    const abbrs = SPOT_DISPLAY.map((s) => s.abbr);
    expect(new Set(abbrs).size).toBe(abbrs.length);
  });
});
