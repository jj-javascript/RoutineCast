import { describe, expect, it } from "vitest";
import { computeChapters, totalDurationMs } from "../src/chapters.js";

describe("chapter offsets", () => {
  it("offsets include accumulated inter-segment gaps", () => {
    const chapters = computeChapters(
      [
        { title: "a", durationMs: 1000 },
        { title: "b", durationMs: 2000 },
        { title: "c", durationMs: 500 },
      ],
      300,
    );
    expect(chapters).toEqual([
      { title: "a", startMs: 0, endMs: 1000 },
      // b starts after a + one gap
      { title: "b", startMs: 1300, endMs: 3300 },
      // c starts after a + b + two gaps
      { title: "c", startMs: 3600, endMs: 4100 },
    ]);
  });

  it("adds no trailing gap to total duration", () => {
    expect(
      totalDurationMs(
        [
          { title: "a", durationMs: 1000 },
          { title: "b", durationMs: 1000 },
        ],
        300,
      ),
    ).toBe(2300);
  });

  it("handles a single segment and the empty routine", () => {
    expect(computeChapters([{ title: "x", durationMs: 500 }], 300)).toEqual([
      { title: "x", startMs: 0, endMs: 500 },
    ]);
    expect(totalDurationMs([], 300)).toBe(0);
  });
});
