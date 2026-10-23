import { describe, expect, test } from "bun:test";
import { historyOf, record, redo, undo } from "./history";

describe("history", () => {
  test("undo steps back and redo steps forward again", () => {
    const twice = record(record(historyOf(0), 1), 2);
    expect(undo(twice).present).toBe(1);
    expect(undo(undo(twice)).present).toBe(0);
    expect(redo(undo(twice)).present).toBe(2);
  });

  test("a new edit after an undo drops what could have been redone", () => {
    const branched = record(undo(record(historyOf(0), 1)), 5);
    expect(branched.present).toBe(5);
    expect(redo(branched)).toBe(branched);
  });

  test("an edit that changes nothing isn't recorded", () => {
    const start = historyOf([1]);
    expect(record(start, start.present)).toBe(start);
  });

  test("undo and redo at either end change nothing", () => {
    const start = historyOf(0);
    expect(undo(start)).toBe(start);
    expect(redo(start)).toBe(start);
  });
});
