import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import NodeID3 from "node-id3";
import {
  assetObjectKey,
  buildAssetKey,
  computeChapters,
  emptyDoc,
  RealFfmpeg,
  type Segment,
} from "@routinecast/shared";
import { runBuild } from "../src/server/build.js";
import { RoutinesStore } from "../src/server/store.js";
import { FakeNotifier } from "../src/server/notify.js";
import { InMemoryStore, testConfig } from "./helpers.js";

const run = promisify(execFile);

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await run("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * E2E [fixture stitch]: generate real fixture audio, run the full build
 * pipeline against in-memory R2, then read the published mp3's ID3 CHAP
 * frames and assert alignment with the expected offsets (cumulative
 * post-trim durations + accumulated gaps) within tolerance.
 */
describe("E2E: fixture stitch with chapter alignment", async () => {
  if (!(await ffmpegAvailable())) {
    it.skip("ffmpeg not available", () => {});
    return;
  }

  it("stitches fixture audio and writes aligned chapters", async () => {
    const ffmpeg = new RealFfmpeg();
    const workDir = await mkdtemp(join(tmpdir(), "routinecast-e2e-"));
    try {
      // --- fixture audio: 2s and 3s sine waves, normalized through the spec
      const state = new InMemoryStore();
      const feed = new InMemoryStore();
      const store = new RoutinesStore(state);
      const notifier = new FakeNotifier();

      const doc = emptyDoc("t".repeat(32));
      doc.gapMs = 300;
      const fixtureSpecs = [
        { id: "s1", title: "Segment one", secs: 2 },
        { id: "s2", title: "Segment two", secs: 3 },
      ];
      for (const spec of fixtureSpecs) {
        const rawPath = join(workDir, `${spec.id}-raw.wav`);
        const normPath = join(workDir, `${spec.id}.mp3`);
        await run("ffmpeg", [
          "-y",
          "-f",
          "lavfi",
          "-i",
          `sine=frequency=440:duration=${spec.secs}`,
          rawPath,
        ]);
        await ffmpeg.normalize(rawPath, normPath);
        const durationMs = await ffmpeg.measureDurationMs(normPath);
        const assetKey = buildAssetKey({ sourceKey: `vid-${spec.id}` });
        const { readFile } = await import("node:fs/promises");
        await state.putObject(assetObjectKey(assetKey), await readFile(normPath), "audio/mpeg");

        const segment: Segment = {
          id: spec.id,
          title: spec.title,
          source: { kind: "youtube", videoId: `vid-${spec.id}` },
          refresh: "static",
        };
        doc.segments[spec.id] = segment;
        doc.routine.push(spec.id);
        doc.assets[spec.id] = { lastGoodAssetKey: assetKey, playedVideoIds: [] };
        doc.assetIndex[assetKey] = {
          uploadedAt: new Date().toISOString(),
          durationMs,
          producedBy: "agent",
        };
      }
      await state.putJson("routines.json", doc);

      // --- run the build
      const outcome = await runBuild({ state, feed, store, ffmpeg, notifier, config: testConfig });
      expect(outcome.ok).toBe(true);
      const build = outcome.build!;
      expect(build.staleSegments).toEqual([]);
      expect(build.skippedSegments).toEqual([]);

      // --- mp3 + RSS landed in the public bucket
      const mp3 = feed.objects.get(build.mp3Key);
      expect(mp3).toBeDefined();
      const feedXml = feed.objects.get(`${doc.feedToken}/feed.xml`);
      expect(feedXml).toBeDefined();
      expect(Buffer.from(feedXml!.bytes).toString()).toContain(build.rssGuid);

      // --- chapter alignment: read CHAP frames back from the real mp3
      const tags = NodeID3.read(Buffer.from(mp3!.bytes));
      const chapters = tags.chapter;
      expect(chapters).toHaveLength(2);

      const included = fixtureSpecs.map((spec) => ({
        title: spec.title,
        durationMs: doc.assetIndex[buildAssetKey({ sourceKey: `vid-${spec.id}` })]!.durationMs,
      }));
      const expected = computeChapters(included, 300);

      const TOLERANCE_MS = 120; // mp3 frame granularity
      for (let i = 0; i < expected.length; i++) {
        expect(chapters[i]!.tags.title).toBe(expected[i]!.title);
        expect(Math.abs(chapters[i]!.startTimeMs - expected[i]!.startMs)).toBeLessThan(
          TOLERANCE_MS,
        );
      }
      // Second chapter must start after seg0 duration + the 300ms gap.
      expect(chapters[1]!.startTimeMs).toBeGreaterThanOrEqual(included[0]!.durationMs + 250);

      // dead-man's switch pinged after mp3+RSS written
      expect(notifier.deadMansPings).toBe(1);
      expect(notifier.alerts).toEqual([]);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
