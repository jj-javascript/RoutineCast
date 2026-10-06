import { describe, expect, it } from "vitest";
import { evaluateWatchdog } from "../src/watchdog.js";
import { emptyDoc, type BuildRecord, type Segment } from "../src/types.js";

const dailySeg: Segment = {
  id: "d1",
  title: "Daily instrumental",
  source: { kind: "youtube" },
  refresh: "daily",
  dailySelector: { query: "lofi", strategy: "latest" },
};

function okBuild(overrides: Partial<BuildRecord> = {}): BuildRecord {
  return {
    date: "2026-09-22",
    assetKeys: ["k1"],
    mp3Key: "t/builds/x.mp3",
    rssGuid: "g1",
    durationMs: 1000,
    staleSegments: [],
    skippedSegments: [],
    ffmpegVersions: {},
    builtAt: "2026-09-22T11:00:00Z",
    ...overrides,
  };
}

describe("watchdog rules", () => {
  const now = new Date("2026-09-22T12:00:00Z");

  it("alerts when the agent missed check-in > 24h and daily segments exist", () => {
    const doc = emptyDoc("t".repeat(20));
    doc.segments = { d1: dailySeg };
    doc.agent.lastCheckInAt = "2026-09-20T12:00:00Z"; // 48h ago
    const alerts = evaluateWatchdog({ doc, now, buildResult: okBuild() });
    expect(alerts.map((a) => a.kind)).toContain("agent-missed-checkin");
  });

  it("does NOT alert about the agent when there are no daily segments", () => {
    const doc = emptyDoc("t".repeat(20));
    const alerts = evaluateWatchdog({ doc, now, buildResult: okBuild() });
    expect(alerts).toEqual([]);
  });

  it("alerts on build failure and skips the degraded rule", () => {
    const doc = emptyDoc("t".repeat(20));
    const alerts = evaluateWatchdog({ doc, now, buildResult: null, buildError: "ffmpeg died" });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe("build-failed");
    expect(alerts[0]!.message).toContain("ffmpeg died");
  });

  it("alerts on degraded builds with segment titles", () => {
    const doc = emptyDoc("t".repeat(20));
    doc.segments = { d1: dailySeg };
    doc.agent.lastCheckInAt = "2026-09-22T11:00:00Z";
    const alerts = evaluateWatchdog({
      doc,
      now,
      buildResult: okBuild({ staleSegments: ["d1"], skippedSegments: ["ghost"] }),
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe("build-degraded");
    expect(alerts[0]!.message).toContain("Daily instrumental");
    expect(alerts[0]!.message).toContain("ghost");
  });

  it("is quiet for a healthy build with a checked-in agent", () => {
    const doc = emptyDoc("t".repeat(20));
    doc.segments = { d1: dailySeg };
    doc.agent.lastCheckInAt = "2026-09-22T10:00:00Z";
    const alerts = evaluateWatchdog({ doc, now, buildResult: okBuild() });
    expect(alerts).toEqual([]);
  });
});
