import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  RealFfmpeg,
  selectFromPool,
  type DailySelector,
  type Ffmpeg,
} from "@routinecast/shared";
import { loadAgentConfig, type AgentConfig } from "./config.js";
import { RealYtDlp, type YtDlp } from "./ytdlp.js";

const run = promisify(execFile);

/** Job shape returned by the poll endpoint (enriched with play history). */
interface PolledJob {
  segmentId: string;
  selector?: DailySelector;
  videoId?: string;
  startSec?: number;
  endSec?: number;
  playedVideoIds: string[];
}

interface ResolveResponse {
  cached: boolean;
  assetKey: string;
  uploadUrl?: string;
}

const SELECTOR_CANDIDATE_LIMIT = 25;

export async function runAgentOnce(deps: {
  config: AgentConfig;
  ytdlp: YtDlp;
  ffmpeg: Ffmpeg;
  fetchFn?: typeof fetch;
  log?: (msg: string) => void;
}): Promise<{ processed: number; failed: number }> {
  const { config, ytdlp, ffmpeg } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const log = deps.log ?? ((msg: string) => console.log(`[agent] ${msg}`));
  const headers = { Authorization: `Bearer ${config.apiToken}` };

  // Best-effort yt-dlp self-update (YouTube breaks old versions regularly).
  await run("brew", ["upgrade", "yt-dlp"]).catch(() => {
    log("yt-dlp brew upgrade skipped (not installed via brew or already current)");
  });

  // Poll = heartbeat.
  const pollRes = await fetchFn(`${config.apiBaseUrl}/api/agent/jobs`, { headers });
  if (!pollRes.ok) throw new Error(`poll failed: ${pollRes.status}`);
  const { jobs } = (await pollRes.json()) as { jobs: PolledJob[] };
  log(`${jobs.length} pending job(s)`);

  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await processJob(job, { config, ytdlp, ffmpeg, fetchFn, log });
      processed++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      log(`job ${job.segmentId} failed: ${message}`);
      await fetchFn(`${config.apiBaseUrl}/api/agent/jobs/${job.segmentId}/fail`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ error: message }),
      }).catch(() => undefined);
    }
  }
  return { processed, failed };
}

async function processJob(
  job: PolledJob,
  deps: {
    config: AgentConfig;
    ytdlp: YtDlp;
    ffmpeg: Ffmpeg;
    fetchFn: typeof fetch;
    log: (msg: string) => void;
  },
): Promise<void> {
  const { config, ytdlp, ffmpeg, fetchFn, log } = deps;
  const headers = { Authorization: `Bearer ${config.apiToken}` };

  // 1. Resolve the videoId (selector jobs resolve at the residential IP —
  //    datacenter-IP metadata queries are as unreliable as fetches).
  let videoId = job.videoId;
  let poolReset = false;
  if (!videoId) {
    if (!job.selector) throw new Error("job has neither videoId nor selector");
    const candidates = await ytdlp.resolveSelector(job.selector, SELECTOR_CANDIDATE_LIMIT);
    const selection = selectFromPool(job.selector, candidates, job.playedVideoIds);
    if (!selection.videoId) {
      throw new Error("selector returned no candidates");
    }
    videoId = selection.videoId;
    poolReset = selection.poolReset;
    log(`resolved selector -> ${videoId}${poolReset ? " (pool reset)" : ""}`);
  }

  // 2. Report resolution; server tells us cache hit vs. upload URL.
  const resolveRes = await fetchFn(
    `${config.apiBaseUrl}/api/agent/jobs/${job.segmentId}/resolve`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, poolReset }),
    },
  );
  if (!resolveRes.ok) throw new Error(`resolve failed: ${resolveRes.status}`);
  const resolved = (await resolveRes.json()) as ResolveResponse;

  if (resolved.cached) {
    log(`cache hit for ${videoId} — no download needed`);
    return;
  }
  if (!resolved.uploadUrl) throw new Error("server returned no uploadUrl for cache miss");

  // 3. Fetch + normalize (shared spec) + measure duration by decode.
  const workDir = await mkdtemp(join(tmpdir(), "routinecast-agent-"));
  try {
    const rawPath = join(workDir, "raw.audio");
    const normPath = join(workDir, "normalized.mp3");
    await ytdlp.fetchAudio(videoId, rawPath);
    const cut = {
      ...(job.startSec !== undefined ? { startSec: job.startSec } : {}),
      ...(job.endSec !== undefined ? { endSec: job.endSec } : {}),
    };
    await ffmpeg.normalize(rawPath, normPath, cut);
    const durationMs = await ffmpeg.measureDurationMs(normPath);
    const bytes = await readFile(normPath);

    // 4. Upload directly to R2 via the presigned URL.
    const uploadRes = await fetchFn(resolved.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "audio/mpeg" },
      body: new Uint8Array(bytes),
    });
    if (!uploadRes.ok) throw new Error(`R2 upload failed: ${uploadRes.status}`);

    // 5. Report completion (server verifies the asset landed).
    const completeRes = await fetchFn(
      `${config.apiBaseUrl}/api/agent/jobs/${job.segmentId}/complete`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          assetKey: resolved.assetKey,
          durationMs,
          poolReset,
          ffmpegVersion: await ffmpeg.version(),
        }),
      },
    );
    if (!completeRes.ok) throw new Error(`complete failed: ${completeRes.status}`);
    log(`uploaded ${videoId} (${(durationMs / 1000).toFixed(1)}s)`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// Entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadAgentConfig();
  const ytdlp = new RealYtDlp(config.ytDlpBin, config.cookiesFromBrowser);
  const ffmpeg = new RealFfmpeg(config.ffmpegBin);
  runAgentOnce({ config, ytdlp, ffmpeg })
    .then(({ processed, failed }) => {
      console.log(`[agent] done: ${processed} processed, ${failed} failed`);
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error(`[agent] fatal: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
