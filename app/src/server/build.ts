import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import NodeID3 from "node-id3";
import {
  assetObjectKey,
  buildMp3Path,
  classifySegment,
  computeChapters,
  evaluateWatchdog,
  feedPath,
  generateRss,
  jobForSegment,
  planRetention,
  segmentsNeedingRefresh,
  totalDurationMs,
  upsertJob,
  type BuildRecord,
  type Chapter,
  type Ffmpeg,
  type RoutinesDoc,
} from "@routinecast/shared";
import type { ObjectStore } from "./r2.js";
import type { RoutinesStore } from "./store.js";
import type { Notifier } from "./notify.js";
import type { AppConfig } from "./config.js";

export interface BuildDeps {
  state: ObjectStore;
  feed: ObjectStore;
  store: RoutinesStore;
  ffmpeg: Ffmpeg;
  notifier: Notifier;
  config: AppConfig;
  now?: Date;
}

export interface BuildOutcome {
  ok: boolean;
  build?: BuildRecord;
  error?: string;
}

/**
 * The daily build. Runs synchronously inside the cron-held HTTP request
 * (the open connection keeps the Render instance alive — D4/D5).
 *
 * Order of operations matters:
 *   1. snapshot state (D17) — undo for a corrupting write
 *   2. classify segments (fresh / stale-fallback / skip-and-flag)
 *   3. stitch + chapters
 *   4. publish mp3 + RSS ONLY on non-empty success (previous episode stays)
 *   5. record build, enqueue tomorrow's daily jobs (upsert, D24)
 *   6. watchdog alerts (ntfy) for degraded/failed runs
 *   7. healthchecks.io ping ONLY after mp3+RSS are written
 *   8. retention cleanup (keeps upload originals)
 */
export async function runBuild(deps: BuildDeps): Promise<BuildOutcome> {
  const now = deps.now ?? new Date();
  let buildError: string | undefined;
  let buildRecord: BuildRecord | null = null;

  try {
    await deps.store.snapshot(now);
    const doc = await deps.store.read();
    const cycleStart = doc.builds.length > 0 ? doc.builds[doc.builds.length - 1]!.builtAt : null;

    // --- classify ------------------------------------------------------
    const included: { segmentId: string; title: string; assetKey: string; durationMs: number }[] = [];
    const staleSegments: string[] = [];
    const skippedSegments: string[] = [];

    for (const segmentId of doc.routine) {
      const segment = doc.segments[segmentId];
      if (!segment) continue; // dangling id in routine — ignore silently
      const result = classifySegment({
        segment,
        assetState: doc.assets[segmentId],
        cycleStart,
        assetIndex: doc.assetIndex,
      });
      if (result.freshness === "skip" || !result.assetKey) {
        skippedSegments.push(segmentId);
        continue;
      }
      const meta = doc.assetIndex[result.assetKey];
      if (!meta) {
        // last-good pointer references an asset with no metadata — treat as skip.
        skippedSegments.push(segmentId);
        continue;
      }
      if (result.freshness === "stale") staleSegments.push(segmentId);
      included.push({
        segmentId,
        title: segment.title,
        assetKey: result.assetKey,
        durationMs: meta.durationMs,
      });
    }

    if (included.length === 0) {
      buildError = "no segments had audio available — previous episode left in place";
      await finishRun(deps, doc, null, buildError, now);
      return { ok: false, error: buildError };
    }

    // --- stitch --------------------------------------------------------
    const workDir = await mkdtemp(join(tmpdir(), "routinecast-build-"));
    try {
      const inputPaths: string[] = [];
      for (const [i, item] of included.entries()) {
        const obj = await deps.state.getObject(assetObjectKey(item.assetKey));
        if (!obj) throw new Error(`asset missing from R2: ${item.assetKey}`);
        const p = join(workDir, `seg-${i}.mp3`);
        await writeFile(p, obj.bytes);
        inputPaths.push(p);
      }

      const stitchedPath = join(workDir, "stitched.mp3");
      await deps.ffmpeg.concat(inputPaths, doc.gapMs, stitchedPath);

      // Chapters: offsets = cumulative post-trim durations + accumulated gaps.
      const chapters: Chapter[] = computeChapters(included, doc.gapMs);
      const stitched = await readFile(stitchedPath);
      const tagged = NodeID3.write(
        {
          chapter: chapters.map((c) => ({
            elementID: `chp${c.startMs}`,
            startTimeMs: c.startMs,
            endTimeMs: c.endMs,
            tags: { title: c.title },
          })),
          title: `Routine — ${formatDate(now)}`,
        } as Parameters<typeof NodeID3.write>[0],
        stitched,
      );
      const finalBytes = Buffer.isBuffer(tagged) ? tagged : stitched;

      // --- publish (gate: only on non-empty success) ---------------------
      const rssGuid = crypto.randomUUID();
      const date = formatDate(now);
      const mp3Key = buildMp3Path(doc.feedToken, date, rssGuid);
      await deps.feed.putObject(mp3Key, finalBytes, "audio/mpeg");

      buildRecord = {
        date,
        assetKeys: included.map((i) => i.assetKey),
        mp3Key,
        rssGuid,
        durationMs: totalDurationMs(included, doc.gapMs),
        staleSegments,
        skippedSegments,
        ffmpegVersions: { app: await deps.ffmpeg.version() },
        builtAt: now.toISOString(),
      };

      const rss = generateRss(
        {
          title: deps.config.feedTitle,
          description: "Personal daily routine audio",
          publicBaseUrl: deps.config.r2.feedPublicBaseUrl,
          feedToken: doc.feedToken,
        },
        buildRecord,
        finalBytes.length,
      );
      await deps.feed.putObject(feedPath(doc.feedToken), Buffer.from(rss, "utf-8"), "application/rss+xml");

      // --- record + enqueue tomorrow's jobs (single transaction) --------
      const record = buildRecord;
      await deps.store.updateRoutines((current) => {
        const next: RoutinesDoc = {
          ...current,
          builds: [...current.builds, record],
        };
        let jobs = next.jobs;
        for (const seg of segmentsNeedingRefresh(Object.values(current.segments))) {
          const job = jobForSegment(seg, now.toISOString());
          if (job) jobs = upsertJob(jobs, job);
        }
        return { ...next, jobs };
      });

      await finishRun(deps, doc, record, undefined, now);
      await runRetention(deps, now);
      return { ok: true, build: record };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  } catch (err) {
    buildError = err instanceof Error ? err.message : String(err);
    const doc = await deps.store.read().catch(() => null);
    if (doc) await finishRun(deps, doc, null, buildError, now);
    return { ok: false, error: buildError };
  }
}

/** Watchdog alerts + dead-man's switch. healthchecks ping fires ONLY when
 *  the build record exists (mp3+RSS written) — never on acceptance. */
async function finishRun(
  deps: BuildDeps,
  doc: RoutinesDoc,
  build: BuildRecord | null,
  buildError: string | undefined,
  now: Date,
): Promise<void> {
  const alerts = evaluateWatchdog({
    doc,
    now,
    buildResult: build,
    ...(buildError !== undefined ? { buildError } : {}),
  });
  await deps.notifier.sendAlerts(alerts);
  if (build) await deps.notifier.pingDeadMansSwitch();
}

async function runRetention(deps: BuildDeps, now: Date): Promise<void> {
  const doc = await deps.store.read();
  const assetObjectKeys = await deps.state.listKeys("assets/");
  const snapshotKeys = await deps.state.listKeys("snapshots/");
  const plan = planRetention({
    doc,
    existingAssetKeys: assetObjectKeys.map((k) => k.replace(/^assets\//, "").replace(/\.mp3$/, "")),
    existingSnapshotKeys: snapshotKeys,
    now,
  });
  for (const key of plan.assetKeysToDelete) {
    await deps.state.deleteObject(assetObjectKey(key));
  }
  for (const key of plan.snapshotKeysToDelete) {
    await deps.state.deleteObject(key);
  }
  if (plan.buildsToDelete.length > 0) {
    const doomed = new Set(plan.buildsToDelete.map((b) => b.rssGuid));
    await deps.store.updateRoutines((current) => ({
      ...current,
      builds: current.builds.filter((b) => !doomed.has(b.rssGuid)),
    }));
  }
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
