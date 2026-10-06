import { describe, expect, it } from "vitest";
import { planRetention } from "../src/retention.js";
import { emptyDoc, type BuildRecord } from "../src/types.js";

function build(date: string, assetKeys: string[], builtAt: string): BuildRecord {
  return {
    date,
    assetKeys,
    mp3Key: `t/builds/${date}-g.mp3`,
    rssGuid: `g-${date}`,
    durationMs: 1000,
    staleSegments: [],
    skippedSegments: [],
    ffmpegVersions: {},
    builtAt,
  };
}

describe("retention mark-and-sweep", () => {
  const now = new Date("2026-09-22T12:00:00Z");

  it("deletes builds older than the retention window", () => {
    const doc = emptyDoc("t".repeat(20));
    doc.builds = [
      build("2026-09-01", ["old"], "2026-09-01T07:00:00Z"), // > 14 days
      build("2026-09-20", ["new"], "2026-09-20T07:00:00Z"),
    ];
    const plan = planRetention({ doc, existingAssetKeys: [], existingSnapshotKeys: [], now });
    expect(plan.buildsToDelete.map((b) => b.date)).toEqual(["2026-09-01"]);
  });

  it("keeps assets referenced by last-good, retained builds; deletes orphans", () => {
    const doc = emptyDoc("t".repeat(20));
    doc.assets = { s1: { lastGoodAssetKey: "keep-lastgood", playedVideoIds: [] } };
    doc.builds = [build("2026-09-20", ["keep-build"], "2026-09-20T07:00:00Z")];
    const plan = planRetention({
      doc,
      existingAssetKeys: ["keep-lastgood", "keep-build", "orphan"],
      existingSnapshotKeys: [],
      now,
    });
    expect(plan.assetKeysToDelete).toEqual(["orphan"]);
  });

  it("assets referenced only by EXPIRED builds are swept", () => {
    const doc = emptyDoc("t".repeat(20));
    doc.builds = [build("2026-09-01", ["old-only"], "2026-09-01T07:00:00Z")];
    const plan = planRetention({
      doc,
      existingAssetKeys: ["old-only"],
      existingSnapshotKeys: [],
      now,
    });
    expect(plan.assetKeysToDelete).toEqual(["old-only"]);
  });

  it("caps snapshots at the keep count (oldest first)", () => {
    const doc = emptyDoc("t".repeat(20));
    const snapshots = Array.from(
      { length: 16 },
      (_, i) => `snapshots/2026-09-${String(i + 1).padStart(2, "0")}T00-00-00.json`,
    );
    const plan = planRetention({
      doc,
      existingAssetKeys: [],
      existingSnapshotKeys: snapshots,
      now,
    });
    expect(plan.snapshotKeysToDelete).toEqual(snapshots.slice(0, 2));
  });
});
