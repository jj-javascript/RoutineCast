import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetObjectKey, buildAssetKey, type Ffmpeg } from "@routinecast/shared";
import type { ObjectStore } from "./r2.js";

/**
 * Cloud-side ingest for CMS uploads. Uploads go through the SAME shared
 * normalize spec as agent fetches (spec review iteration 1, issue 3) —
 * the app ships ffmpeg for stitching anyway. The original file is retained
 * in R2 (uploads/) so normalize-spec changes can re-process from source.
 */
export async function ingestUpload(deps: {
  state: ObjectStore;
  ffmpeg: Ffmpeg;
  originalBytes: Buffer;
  originalFilename: string;
  cut?: { startSec?: number; endSec?: number };
}): Promise<{ fileKey: string; assetKey: string; durationMs: number }> {
  const fileKey = `uploads/${crypto.randomUUID()}-${deps.originalFilename.replaceAll(/[^a-zA-Z0-9._-]/g, "_")}`;
  await deps.state.putObject(fileKey, deps.originalBytes, "application/octet-stream");

  const assetKey = buildAssetKey({
    sourceKey: fileKey,
    ...(deps.cut?.startSec !== undefined ? { startSec: deps.cut.startSec } : {}),
    ...(deps.cut?.endSec !== undefined ? { endSec: deps.cut.endSec } : {}),
  });

  const workDir = await mkdtemp(join(tmpdir(), "routinecast-upload-"));
  try {
    const inputPath = join(workDir, "original");
    const outputPath = join(workDir, "normalized.mp3");
    await writeFile(inputPath, deps.originalBytes);
    await deps.ffmpeg.normalize(inputPath, outputPath, deps.cut);
    const normalized = await readFile(outputPath);
    const durationMs = await deps.ffmpeg.measureDurationMs(outputPath);
    await deps.state.putObject(assetObjectKey(assetKey), normalized, "audio/mpeg");
    return { fileKey, assetKey, durationMs };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
