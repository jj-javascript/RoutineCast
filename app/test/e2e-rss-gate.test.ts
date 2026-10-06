import { describe, expect, it } from "vitest";
import { assetObjectKey, buildAssetKey, emptyDoc, type Segment } from "@routinecast/shared";
import { runBuild } from "../src/server/build.js";
import { RoutinesStore } from "../src/server/store.js";
import { FakeNotifier } from "../src/server/notify.js";
import { InMemoryStore, testConfig } from "./helpers.js";
import type { Ffmpeg } from "@routinecast/shared";

/** Fake ffmpeg: concat produces a deterministic buffer; no real encoding. */
class FakeFfmpeg implements Ffmpeg {
  concatCalls = 0;
  async normalize(): Promise<void> {
    throw new Error("not used in this test");
  }
  async measureDurationMs(): Promise<number> {
    throw new Error("not used in this test");
  }
  async concat(inputs: string[]): Promise<void> {
    this.concatCalls++;
    if (inputs.length === 0) throw new Error("concat: no inputs");
  }
  async version(): Promise<string> {
    return "fake-ffmpeg 0.0";
  }
}

/**
 * E2E [RSS publish gate]: a failed/empty build must leave the previous RSS
 * item and mp3 in place; a successful build publishes a NEW item with a
 * unique GUID and per-build mp3 path.
 */
describe("E2E: RSS publish gate", () => {
  function seedDoc(): ReturnType<typeof emptyDoc> {
    const doc = emptyDoc("t".repeat(32));
    const seg: Segment = {
      id: "d1",
      title: "Daily",
      source: { kind: "youtube" },
      refresh: "daily",
      dailySelector: { playlistId: "PL1", strategy: "latest" },
    };
    doc.segments = { d1: seg };
    doc.routine = ["d1"];
    return doc;
  }

  it("zero included segments -> no RSS/mp3 write, previous feed untouched, alert sent", async () => {
    const state = new InMemoryStore();
    const feed = new InMemoryStore();
    const store = new RoutinesStore(state);
    const notifier = new FakeNotifier();
    const ffmpeg = new FakeFfmpeg();

    const doc = seedDoc(); // segment has NO asset -> skip-and-flag
    await state.putJson("routines.json", doc);
    // Pre-existing feed from a previous good day:
    await feed.putObject(`${doc.feedToken}/feed.xml`, Buffer.from("OLD FEED"), "application/rss+xml");

    const outcome = await runBuild({ state, feed, store, ffmpeg, notifier, config: testConfig });

    expect(outcome.ok).toBe(false);
    expect(ffmpeg.concatCalls).toBe(0);
    // Feed untouched:
    expect(Buffer.from(feed.objects.get(`${doc.feedToken}/feed.xml`)!.bytes).toString()).toBe(
      "OLD FEED",
    );
    expect([...feed.objects.keys()].filter((k) => k.endsWith(".mp3"))).toEqual([]);
    // Failure alert sent; dead-man's switch NOT pinged:
    expect(notifier.alerts.map((a) => a.kind)).toContain("build-failed");
    expect(notifier.deadMansPings).toBe(0);
    // No build record persisted:
    const after = await store.read();
    expect(after.builds).toEqual([]);
  });

  it("successful build publishes unique GUID + per-build path; second build differs", async () => {
    const state = new InMemoryStore();
    const feed = new InMemoryStore();
    const store = new RoutinesStore(state);
    const notifier = new FakeNotifier();

    // Fake ffmpeg that actually WRITES a file so downstream readFile works.
    const writingFfmpeg: Ffmpeg = {
      async normalize() {},
      async measureDurationMs() {
        return 1000;
      },
      async concat(_inputs, _gapMs, outputPath) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(outputPath, Buffer.from("fake mp3 bytes"));
      },
      async version() {
        return "fake";
      },
    };

    const doc = seedDoc();
    const assetKey = buildAssetKey({ sourceKey: "vid1" });
    doc.assets = { d1: { lastGoodAssetKey: assetKey, playedVideoIds: [] } };
    doc.assetIndex = {
      [assetKey]: { uploadedAt: new Date().toISOString(), durationMs: 60_000, producedBy: "agent" },
    };
    await state.putJson("routines.json", doc);
    await state.putObject(assetObjectKey(assetKey), Buffer.from("asset"), "audio/mpeg");

    const deps = { state, feed, store, ffmpeg: writingFfmpeg, notifier, config: testConfig };
    const first = await runBuild(deps);
    expect(first.ok).toBe(true);

    const second = await runBuild({ ...deps, now: new Date(Date.now() + 60_000) });
    expect(second.ok).toBe(true);

    expect(second.build!.rssGuid).not.toBe(first.build!.rssGuid);
    expect(second.build!.mp3Key).not.toBe(first.build!.mp3Key);

    // Feed points at the LATEST build only (v1 single-item feed).
    const feedXml = Buffer.from(
      feed.objects.get(`${doc.feedToken}/feed.xml`)!.bytes,
    ).toString();
    expect(feedXml).toContain(second.build!.rssGuid);
    expect(feedXml).not.toContain(first.build!.rssGuid);

    // Both mp3s remain in the bucket (retention window keeps them 14 days).
    expect(feed.objects.has(first.build!.mp3Key)).toBe(true);
    expect(feed.objects.has(second.build!.mp3Key)).toBe(true);

    // Daily segment got a fresh job enqueued at end of each build (D24 upsert).
    const after = await store.read();
    expect(after.jobs.filter((j) => j.segmentId === "d1")).toHaveLength(1);
    expect(notifier.deadMansPings).toBe(2);
  });
});
