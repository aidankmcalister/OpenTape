import { expect, test } from "bun:test";
import { formatTime } from "./time";

test("formats zero", () => {
  expect(formatTime(0)).toBe("0:00.00");
});

test("formats seconds and hundredths", () => {
  expect(formatTime(6350)).toBe("0:06.35");
});

test("formats minutes", () => {
  expect(formatTime(125_000)).toBe("2:05.00");
});
