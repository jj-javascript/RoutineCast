import { describe, expect, it } from "vitest";
import { classifySegment, expectedAssetKeyForSegment } from "../src/staleness.js";
import type { Segment } from "../src/types.js";

const staticSeg: Segment = {
  id: "s1",
  title: "Static",
  source: { kind: "youtube", videoId: "v1" },
  refresh: "static",
};

const dailySeg: Segment = {
  id: "d1",
  title: "Daily",
  source: { kind: "youtube" },
  refresh: "daily",
  dailySelector: { playlistId: "PL123", strategy: "latest" },
};

describe("staleness classifier", () => {
  it("static segment with an asset is fresh regardless of cycle", () => {
    const r = classifySegment({
      segment: staticSeg,
      assetState: { lastGoodAssetKey: "k1", playedVideoIds: [] },
      cycleStart: "2026-09-21T00:00:00Z",
      assetIndex: { k1: { uploadedAt: "2026-09-01T00:00:00Z", durationMs: 1000, producedBy: "agent" } },
    });
    expect(r).toEqual({ freshness: "fresh", assetKey: "k1" });
  });

  it("daily segment resolved this cycle is fresh", () => {
    const r = classifySegment({
      segment: dailySeg,
      assetState: { lastGoodAssetKey: "k1", playedVideoIds: [] },
      cycleStart: "2026-09-21T00:00:00Z",
      assetIndex: { k1: { uploadedAt: "2026-09-22T01:00:00Z", durationMs: 1000, producedBy: "agent" } },
    });
    expect(r.freshness).toBe("fresh");
  });

  it("daily segment NOT resolved this cycle is stale-fallback", () => {
    const r = classifySegment({
      segment: dailySeg,
      assetState: { lastGoodAssetKey: "k1", playedVideoIds: [] },
      cycleStart: "2026-09-21T00:00:00Z",
      assetIndex: { k1: { uploadedAt: "2026-09-20T01:00:00Z", durationMs: 1000, producedBy: "agent" } },
    });
    expect(r).toEqual({ freshness: "stale", assetKey: "k1" });
  });

  it("first-ever build (no cycle start) treats any uploaded asset as fresh", () => {
    const r = classifySegment({
      segment: dailySeg,
      assetState: { lastGoodAssetKey: "k1", playedVideoIds: [] },
      cycleStart: null,
      assetIndex: { k1: { uploadedAt: "2026-09-20T01:00:00Z", durationMs: 1000, producedBy: "agent" } },
    });
    expect(r.freshness).toBe("fresh");
  });

  it("no asset at all is skip", () => {
    const r = classifySegment({
      segment: dailySeg,
      assetState: undefined,
      cycleStart: null,
      assetIndex: {},
    });
    expect(r.freshness).toBe("skip");
  });
});

describe("expectedAssetKeyForSegment", () => {
  it("uses the resolved videoId for daily youtube segments", () => {
    const withResolved = expectedAssetKeyForSegment(dailySeg, "resolvedVid");
    const other = expectedAssetKeyForSegment(dailySeg, "otherVid");
    expect(withResolved).not.toBe(other);
    expect(withResolved).toMatch(/^[a-f0-9]{24}$/);
  });

  it("returns null for youtube with no videoId and no resolution", () => {
    expect(expectedAssetKeyForSegment(dailySeg)).toBeNull();
  });

  it("uses fileKey for uploads", () => {
    const uploadSeg: Segment = {
      id: "u1",
      title: "Up",
      source: { kind: "upload", fileKey: "uploads/abc.mp3" },
      refresh: "static",
    };
    expect(expectedAssetKeyForSegment(uploadSeg)).toMatch(/^[a-f0-9]{24}$/);
  });
});
