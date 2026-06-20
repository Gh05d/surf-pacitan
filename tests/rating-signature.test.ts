import { describe, test, expect } from "bun:test";
import { ratingSignature } from "../src/shared/rating-signature";
import type { ForecastDay } from "../src/shared/types";

function fc(hourly: ForecastDay["hourly"]): ForecastDay {
  return {
    date: "2026-06-20",
    location: { name: "Pacitan", lat: -8.22, lng: 111.13 },
    astronomy: { sunrise: "05:30", sunset: "17:30" },
    tideExtremes: [],
    hourly,
  };
}

function hr(hour: number, surfable: Record<string, "red" | "yellow" | "green">): ForecastDay["hourly"][number] {
  return {
    hour,
    tide: { height: 1.0, rising: true },
    swell: { height: 1.5, period: 11, direction: 200 },
    wind: { speed: 8, direction: 30, gusts: 12 },
    weather: { temp: 27, condition: "clear", precipitation: 0 },
    surfable,
  };
}

describe("ratingSignature", () => {
  test("identical rating grids produce identical signatures", () => {
    const a = fc([hr(6, { telengRia: "yellow", pancer: "green", pancerDoor: "green" })]);
    const b = fc([hr(6, { telengRia: "yellow", pancer: "green", pancerDoor: "green" })]);
    expect(ratingSignature(a)).toBe(ratingSignature(b));
  });

  test("a single category flip changes the signature", () => {
    const a = fc([hr(8, { telengRia: "red", pancer: "red", pancerDoor: "green" })]);
    const b = fc([hr(8, { telengRia: "red", pancer: "red", pancerDoor: "red" })]);
    expect(ratingSignature(a)).not.toBe(ratingSignature(b));
  });

  test("numeric-only drift (same categories) keeps the signature stable", () => {
    const a = fc([hr(8, { telengRia: "yellow", pancer: "green", pancerDoor: "green" })]);
    const b = JSON.parse(JSON.stringify(a)) as ForecastDay;
    b.hourly[0].swell.height = 0.91; // changed value, same surfable categories
    b.hourly[0].wind.speed = 14;
    expect(ratingSignature(b)).toBe(ratingSignature(a));
  });

  test("signature is independent of spot-key insertion order", () => {
    const a = fc([hr(8, { telengRia: "yellow", pancer: "green", pancerDoor: "red" })]);
    const b = fc([hr(8, { pancerDoor: "red", pancer: "green", telengRia: "yellow" })]);
    expect(ratingSignature(a)).toBe(ratingSignature(b));
  });
});
