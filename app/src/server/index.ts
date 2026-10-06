import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { serveStatic } from "@hono/node-server/serve-static";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import {
  assetObjectKey,
  classifySegment,
  expectedAssetKeyForSegment,
  failJob,
  feedPath,
  jobForSegment,
  RealFfmpeg,
  removeJob,
  segmentInputSchema,
  upsertJob,
  type Job,
  type RoutinesDoc,
} from "@routinecast/shared";
import { loadConfig } from "./config.js";
import { R2Store } from "./r2.js";
import { RoutinesStore } from "./store.js";
import { HttpNotifier } from "./notify.js";
import { runBuild } from "./build.js";
import { ingestUpload } from "./upload.js";

const config = loadConfig();
const state = new R2Store(config.r2, config.r2.stateBucket);
const feed = new R2Store(config.r2, config.r2.feedBucket);
const store = new RoutinesStore(state);
const ffmpeg = new RealFfmpeg();
const notifier = new HttpNotifier(config);

// Presigner for direct agent -> R2 asset uploads (private bucket).
const presignClient = new S3Client({
  region: "auto",
  endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

const app = new Hono();
app.use("/api/*", bearerAuth({ token: config.apiToken }));

// ---------------------------------------------------------------- CMS API

app.get("/api/state", async (c) => {
  const doc = await store.read();
  const cycleStart = doc.builds.length > 0 ? doc.builds[doc.builds.length - 1]!.builtAt : null;
  const freshness: Record<string, string> = {};
  for (const [id, segment] of Object.entries(doc.segments)) {
    freshness[id] = classifySegment({
      segment,
      assetState: doc.assets[id],
      cycleStart,
      assetIndex: doc.assetIndex,
    }).freshness;
  }
  return c.json({
    doc,
    freshness,
    feedUrl: `${config.r2.feedPublicBaseUrl}/${feedPath(doc.feedToken)}`,
  });
});

app.post("/api/segments", async (c) => {
  const body = segmentInputSchema.parse(await c.req.json());
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const doc = await store.updateRoutines((current) => {
    const segment = { ...body, id };
    let next: RoutinesDoc = {
      ...current,
      segments: { ...current.segments, [id]: segment },
      routine: [...current.routine, id],
      assets: { ...current.assets, [id]: { playedVideoIds: [] } },
    };
    // Enqueue immediately on create (source present, no asset yet).
    const job = jobForSegment(segment, now);
    if (job) next = { ...next, jobs: upsertJob(next.jobs, job) };
    return next;
  });
  return c.json({ segment: doc.segments[id] }, 201);
});

app.put("/api/segments/:id", async (c) => {
  const id = c.req.param("id");
  const body = segmentInputSchema.parse(await c.req.json());
  const now = new Date().toISOString();
  let enqueued = false;
  const doc = await store.updateRoutines((current) => {
    const existing = current.segments[id];
    if (!existing) throw new HttpError(404, "segment not found");
    const updated = { ...body, id };
    const sourceChanged = JSON.stringify(existing.source) !== JSON.stringify(updated.source);
    const refreshChanged =
      existing.refresh !== updated.refresh ||
      JSON.stringify(existing.dailySelector) !== JSON.stringify(updated.dailySelector);
    let next: RoutinesDoc = {
      ...current,
      segments: { ...current.segments, [id]: updated },
    };
    if (sourceChanged || refreshChanged) {
      const job = jobForSegment(updated, now);
      if (job) {
        next = { ...next, jobs: upsertJob(next.jobs, job) };
        enqueued = true;
      }
    }
    return next;
  });
  return c.json({ segment: doc.segments[id], enqueued });
});

app.delete("/api/segments/:id", async (c) => {
  const id = c.req.param("id");
  await store.updateRoutines((current) => {
    const segments = { ...current.segments };
    delete segments[id];
    return {
      ...current,
      segments,
      routine: current.routine.filter((s) => s !== id),
      jobs: removeJob(current.jobs, id),
    };
  });
  return c.body(null, 204);
});

const reorderSchema = z.object({ orderedIds: z.array(z.string()) });
app.put("/api/routine", async (c) => {
  const { orderedIds } = reorderSchema.parse(await c.req.json());
  await store.updateRoutines((current) => {
    const known = new Set(Object.keys(current.segments));
    const next = orderedIds.filter((id) => known.has(id));
    // Append any segments missing from the submitted order (defensive).
    for (const id of current.routine) if (!next.includes(id)) next.push(id);
    return { ...current, routine: next };
  });
  return c.body(null, 204);
});

const looptubeImportSchema = z.object({
  loops: z.array(
    z.object({
      videoId: z.string().min(1),
      title: z.string().optional(),
      startSec: z.number().nonnegative().optional(),
      endSec: z.number().nonnegative().optional(),
    }),
  ),
});
app.post("/api/import/looptube", async (c) => {
  const { loops } = looptubeImportSchema.parse(await c.req.json());
  const now = new Date().toISOString();
  const created: string[] = [];
  await store.updateRoutines((current) => {
    let next = current;
    for (const loop of loops) {
      const id = crypto.randomUUID();
      created.push(id);
      const segment = {
        id,
        title: loop.title ?? `Looptube ${loop.videoId}`,
        source: {
          kind: "youtube" as const,
          videoId: loop.videoId,
          ...(loop.startSec !== undefined ? { startSec: loop.startSec } : {}),
          ...(loop.endSec !== undefined ? { endSec: loop.endSec } : {}),
        },
        refresh: "static" as const,
      };
      next = {
        ...next,
        segments: { ...next.segments, [id]: segment },
        routine: [...next.routine, id],
        assets: { ...next.assets, [id]: { playedVideoIds: [] } },
      };
      const job = jobForSegment(segment, now);
      if (job) next = { ...next, jobs: upsertJob(next.jobs, job) };
    }
    return next;
  });
  return c.json({ created: created.length, ids: created }, 201);
});

app.post("/api/upload", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  const title = form.get("title");
  if (!(file instanceof File) || typeof title !== "string" || !title) {
    throw new HttpError(400, "file and title are required");
  }
  const startSec = form.get("startSec");
  const endSec = form.get("endSec");
  const cut = {
    ...(startSec !== null ? { startSec: Number(startSec) } : {}),
    ...(endSec !== null ? { endSec: Number(endSec) } : {}),
  };
  const bytes = Buffer.from(await file.arrayBuffer());
  const { fileKey, assetKey, durationMs } = await ingestUpload({
    state,
    ffmpeg,
    originalBytes: bytes,
    originalFilename: file.name,
    cut,
  });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await store.updateRoutines((current) => ({
    ...current,
    segments: {
      ...current.segments,
      [id]: { id, title, source: { kind: "upload", fileKey, ...cut }, refresh: "static" },
    },
    routine: [...current.routine, id],
    assets: { ...current.assets, [id]: { lastGoodAssetKey: assetKey, playedVideoIds: [] } },
    assetIndex: {
      ...current.assetIndex,
      [assetKey]: { uploadedAt: now, durationMs, producedBy: "app" },
    },
  }));
  return c.json({ segmentId: id, assetKey, durationMs }, 201);
});

// On-demand rebuild: same hold-open pattern as the cron ping — the open
// connection keeps the instance alive through the stitch.
app.post("/api/build", async (c) => {
  const outcome = await runBuild({ state, feed, store, ffmpeg, notifier, config });
  return c.json(outcome, outcome.ok ? 200 : 500);
});

// -------------------------------------------------------------- AGENT API

// Poll pending jobs. Polling IS the heartbeat (persists agent.lastCheckInAt).
// Jobs are enriched with the segment's playedVideoIds so the agent can run
// random-unplayed selection locally.
app.get("/api/agent/jobs", async (c) => {
  const now = new Date().toISOString();
  const doc = await store.updateRoutines((current) => ({
    ...current,
    agent: { ...current.agent, lastCheckInAt: now },
  }));
  const jobs = doc.jobs
    .filter((j) => j.status === "pending")
    .map((j) => ({
      ...j,
      playedVideoIds: doc.assets[j.segmentId]?.playedVideoIds ?? [],
    }));
  return c.json({ jobs });
});

app.post("/api/agent/heartbeat", async (c) => {
  const now = new Date().toISOString();
  await store.updateRoutines((current) => ({
    ...current,
    agent: { ...current.agent, lastCheckInAt: now },
  }));
  return c.body(null, 204);
});

// Agent reports the resolved videoId for a selector job. Server checks the
// asset cache: hit -> no download needed; miss -> presigned upload URL.
const resolveSchema = z.object({ videoId: z.string().min(1), poolReset: z.boolean().default(false) });
app.post("/api/agent/jobs/:segmentId/resolve", async (c) => {
  const segmentId = c.req.param("segmentId");
  const { videoId, poolReset } = resolveSchema.parse(await c.req.json());
  const doc = await store.read();
  const segment = doc.segments[segmentId];
  if (!segment) throw new HttpError(404, "segment not found");
  const assetKey = expectedAssetKeyForSegment(segment, videoId);
  if (!assetKey) throw new HttpError(400, "cannot compute asset key for segment");

  const existing = await state.getObject(assetObjectKey(assetKey)).catch(() => null);
  if (existing) {
    // Cache hit: no download needed. Update bookkeeping, drop the job.
    const now = new Date().toISOString();
    await store.updateRoutines((current) => {
      const prev = current.assets[segmentId] ?? { playedVideoIds: [] };
      const playedVideoIds = poolReset
        ? [videoId]
        : prev.playedVideoIds.includes(videoId)
          ? prev.playedVideoIds
          : [...prev.playedVideoIds, videoId];
      return {
        ...current,
        assets: {
          ...current.assets,
          [segmentId]: { lastGoodAssetKey: assetKey, playedVideoIds },
        },
        jobs: removeJob(current.jobs, segmentId),
      };
    });
    return c.json({ cached: true, assetKey });
  }

  const uploadUrl = await getSignedUrl(
    presignClient,
    new PutObjectCommand({
      Bucket: config.r2.stateBucket,
      Key: assetObjectKey(assetKey),
      ContentType: "audio/mpeg",
    }),
    { expiresIn: 3600 },
  );
  return c.json({ cached: false, assetKey, uploadUrl });
});

// Agent reports completion after uploading the normalized asset to R2.
const completeSchema = z.object({
  videoId: z.string().min(1),
  assetKey: z.string().min(1),
  durationMs: z.number().positive(),
  poolReset: z.boolean().default(false),
  ffmpegVersion: z.string().optional(),
});
app.post("/api/agent/jobs/:segmentId/complete", async (c) => {
  const segmentId = c.req.param("segmentId");
  const body = completeSchema.parse(await c.req.json());
  const now = new Date().toISOString();
  // Verify the asset actually landed before pointing last-good at it.
  const obj = await state.getObject(assetObjectKey(body.assetKey)).catch(() => null);
  if (!obj) throw new HttpError(409, "asset not found in storage — upload first");
  await store.updateRoutines((current) => {
    const prev = current.assets[segmentId] ?? { playedVideoIds: [] };
    const playedVideoIds = body.poolReset
      ? [body.videoId]
      : prev.playedVideoIds.includes(body.videoId)
        ? prev.playedVideoIds
        : [...prev.playedVideoIds, body.videoId];
    return {
      ...current,
      assets: {
        ...current.assets,
        [segmentId]: { lastGoodAssetKey: body.assetKey, playedVideoIds },
      },
      assetIndex: {
        ...current.assetIndex,
        [body.assetKey]: { uploadedAt: now, durationMs: body.durationMs, producedBy: "agent" },
      },
      jobs: removeJob(current.jobs, segmentId),
      agent: { ...current.agent, lastCheckInAt: now },
    };
  });
  return c.body(null, 204);
});

const failSchema = z.object({ error: z.string().min(1) });
app.post("/api/agent/jobs/:segmentId/fail", async (c) => {
  const segmentId = c.req.param("segmentId");
  const { error } = failSchema.parse(await c.req.json());
  const now = new Date().toISOString();
  await store.updateRoutines((current) => ({
    ...current,
    jobs: current.jobs.map((j): Job => (j.segmentId === segmentId ? failJob(j, error, now) : j)),
    agent: { ...current.agent, lastCheckInAt: now },
  }));
  return c.body(null, 204);
});

// ------------------------------------------------------------- static CMS
app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("*", serveStatic({ path: "./dist/client/index.html" }));

class HttpError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
  }
}

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof z.ZodError) {
    return c.json({ error: "validation failed", issues: err.issues }, 400);
  }
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

const port = config.port;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`routinecast app listening on :${info.port}`);
});
