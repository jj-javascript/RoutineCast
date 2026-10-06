import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildMeasureArgs,
  buildNormalizeArgs,
  type LoudnormMeasurements,
} from "./normalize.js";

const run = promisify(execFile);

/** Thin ffmpeg/ffprobe adapter (Node side). Tests fake this boundary, not
 *  the logic. Used by BOTH the app (upload ingest + stitch) and the Mac
 *  agent (fetch normalize) — one implementation, one spec. */
export interface Ffmpeg {
  /** Two-pass normalize: cut + edges-only trim + loudnorm + uniform mp3 out. */
  normalize(inputPath: string, outputPath: string, cut?: { startSec?: number; endSec?: number }): Promise<void>;
  /** Sample-accurate duration via full decode (D12 — never header metadata). */
  measureDurationMs(inputPath: string): Promise<number>;
  /** Concat+re-encode normalized mp3s with gaps into one mp3. */
  concat(inputs: string[], gapMs: number, outputPath: string): Promise<void>;
  version(): Promise<string>;
}

function cutArgs(cut?: { startSec?: number; endSec?: number }): string[] {
  const args: string[] = [];
  if (cut?.startSec !== undefined) args.push("-ss", String(cut.startSec));
  if (cut?.endSec !== undefined) args.push("-to", String(cut.endSec));
  return args;
}

export class RealFfmpeg implements Ffmpeg {
  constructor(private ffmpegBin = "ffmpeg") {}

  async normalize(
    inputPath: string,
    outputPath: string,
    cut?: { startSec?: number; endSec?: number },
  ): Promise<void> {
    // Pass 1: measure loudness (after trim, before loudnorm).
    const measure = await run(this.ffmpegBin, [
      "-y",
      ...cutArgs(cut),
      "-i",
      inputPath,
      ...buildMeasureArgs(),
      "-f",
      "null",
      "-",
    ]);
    const measurements = parseLoudnormMeasurements(measure.stderr);

    // Pass 2: apply.
    await run(this.ffmpegBin, [
      "-y",
      ...cutArgs(cut),
      "-i",
      inputPath,
      ...buildNormalizeArgs(measurements),
      outputPath,
    ]);
  }

  async measureDurationMs(inputPath: string): Promise<number> {
    // Decode the whole file to null; parse the final time= from stderr.
    // Sample-accurate: immune to mp3 encoder delay/padding header drift.
    const res = await run(this.ffmpegBin, ["-i", inputPath, "-f", "null", "-"]).catch(
      (err: { stderr?: string; message: string }) => {
        if (err.stderr) return { stdout: "", stderr: err.stderr };
        throw err;
      },
    );
    const times = [...res.stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
    const last = times[times.length - 1];
    if (!last) throw new Error(`could not measure duration of ${inputPath}`);
    const [, h, m, s] = last;
    return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000);
  }

  async concat(inputs: string[], gapMs: number, outputPath: string): Promise<void> {
    if (inputs.length === 0) throw new Error("concat: no inputs");
    const args: string[] = ["-y"];
    for (const p of inputs) args.push("-i", p);
    const gapSec = (gapMs / 1000).toFixed(3);
    const parts: string[] = [];
    const labels: string[] = [];
    inputs.forEach((_, i) => {
      parts.push(`[${i}:a]aresample=44100,asetpts=PTS-STARTPTS[s${i}]`);
      labels.push(`[s${i}]`);
      if (i < inputs.length - 1) {
        parts.push(`anullsrc=r=44100:cl=stereo:d=${gapSec}[g${i}]`);
        labels.push(`[g${i}]`);
      }
    });
    parts.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1[out]`);
    args.push(
      "-filter_complex",
      parts.join(";"),
      "-map",
      "[out]",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "192k",
      outputPath,
    );
    await run(this.ffmpegBin, args);
  }

  async version(): Promise<string> {
    const res = await run(this.ffmpegBin, ["-version"]);
    return res.stdout.split("\n")[0] ?? "unknown";
  }
}

export function parseLoudnormMeasurements(stderr: string): LoudnormMeasurements {
  const jsonStart = stderr.lastIndexOf("{");
  const jsonEnd = stderr.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("loudnorm pass 1 produced no measurements");
  }
  const parsed = JSON.parse(stderr.slice(jsonStart, jsonEnd + 1)) as Record<string, string>;
  return {
    inputI: parsed.input_i!,
    inputTp: parsed.input_tp!,
    inputLra: parsed.input_lra!,
    inputThresh: parsed.input_thresh!,
  };
}
