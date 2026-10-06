import { describe, expect, it } from "vitest";
import { selectFromPool } from "../src/selector.js";
import type { DailySelector } from "../src/types.js";

const latest: DailySelector = { playlistId: "PL1", strategy: "latest" };
const randomUnplayed: DailySelector = { playlistId: "PL1", strategy: "random-unplayed" };

describe("selector pools", () => {
  it("latest picks the first (newest) candidate", () => {
    const r = selectFromPool(latest, ["a", "b", "c"], []);
    expect(r).toEqual({ videoId: "a", poolReset: false });
  });

  it("random-unplayed excludes played videos", () => {
    // random() = 0 always picks pool[0]; with "a" played, pool[0] is "b".
    const r = selectFromPool(randomUnplayed, ["a", "b", "c"], ["a"], () => 0);
    expect(r).toEqual({ videoId: "b", poolReset: false });
  });

  it("resets the pool when every candidate is played", () => {
    const r = selectFromPool(randomUnplayed, ["a", "b"], ["a", "b"], () => 0);
    expect(r).toEqual({ videoId: "a", poolReset: true });
  });

  it("returns null when the selector yields no candidates", () => {
    const r = selectFromPool(randomUnplayed, [], [], () => 0);
    expect(r).toEqual({ videoId: null, poolReset: false });
  });

  it("random selection stays in bounds", () => {
    const r = selectFromPool(randomUnplayed, ["a", "b", "c"], [], () => 0.9999);
    expect(r.videoId).toBe("c");
  });
});
