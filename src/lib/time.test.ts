import { expect, test } from "bun:test";
import { formatClock, formatTime } from "./time";

test("formats zero", () => {
  expect(formatTime(0)).toBe("00:00.00");
});

test("formats seconds and hundredths", () => {
  expect(formatTime(6350)).toBe("00:06.35");
});

test("formats minutes", () => {
  expect(formatTime(125_000)).toBe("02:05.00");
});

test("formatClock should show minutes and seconds", () => {
  expect(formatClock(12_900)).toBe("00:12");
  expect(formatClock(605_000)).toBe("10:05");
});
