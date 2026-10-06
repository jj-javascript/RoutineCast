import { createHash } from "node:crypto";
import { SPEC_VERSION } from "./types.js";

/**
 * Shared normalize spec (D7). The agent (YouTube fetches) and the app
 * (CMS uploads) MUST both produce normalized assets through
 * `buildNormalizeArgs()` — a documented spec is a comment; a shared
 * function is a guarantee. SPEC_VERSION is embedded in asset cache keys,
 * so a spec change naturally re-processes affected assets.
 *
 * The chain:
 *   1. cut to [startSec, endSec] if set (handled by caller via -ss/-to)
 *   2. edges-only silence trim: leading/trailing silence below -40 dB
 *      sustained >= 0.5s. Never mid-segment — quiet passages untouched.
 *   3. two-pass loudnorm to -16 LUFS (pass 1 measures, pass 2 applies;
 *      buildNormalizeArgs produces pass-2 args given pass-1 measurements)
 *   4. uniform output: 44.1kHz stereo mp3 at 192k (D13) — stitch then
 *      performs a single final concat encode.
 */

export const NORMALIZE = {
  silenceThresholdDb: -40,
  silenceMinDurationSec: 0.5,
  loudnessTargetLufs: -16,
  sampleRate: 44100,
  channels: 2,
  bitrateKbps: 192,
} as const;

export interface LoudnormMeasurements {
  inputI: string;
  inputTp: string;
  inputLra: string;
  inputThresh: string;
}

/** ffmpeg args for the silence-trim + format half of the chain (pass 1 input
 *  args and pass 2 filter args both build on this). */
export function buildTrimFilter(): string {
  const { silenceThresholdDb, silenceMinDurationSec } = NORMALIZE;
  const t = `${silenceThresholdDb}dB`;
  const d = silenceMinDurationSec.toFixed(1);
  // Leading trim: stop_periods=-1 stops after the first non-silence.
  // Trailing trim: areverse sandwich trims the end.
  return (
    `silenceremove=start_periods=1:start_threshold=${t}:start_duration=${d},` +
    `areverse,` +
    `silenceremove=start_periods=1:start_threshold=${t}:start_duration=${d},` +
    `areverse`
  );
}

/** Pass 1: measure loudness. Run: ffmpeg -ss <start> -to <end> -i in -af <args> -f null - */
export function buildMeasureArgs(): string[] {
  return ["-af", `${buildTrimFilter()},loudnorm=I=${NORMALIZE.loudnessTargetLufs}:print_format=json`];
}

/** Pass 2: apply measured loudnorm + uniform output format. */
export function buildNormalizeArgs(m: LoudnormMeasurements): string[] {
  const { loudnessTargetLufs, sampleRate, channels, bitrateKbps } = NORMALIZE;
  const loudnorm =
    `loudnorm=I=${loudnessTargetLufs}:measure_I=${m.inputI}:measure_TP=${m.inputTp}:` +
    `measure_LRA=${m.inputLra}:measure_thresh=${m.inputThresh}:linear=true`;
  return [
    "-af",
    `${buildTrimFilter()},${loudnorm}`,
    "-ar",
    String(sampleRate),
    "-ac",
    String(channels),
    "-codec:a",
    "libmp3lame",
    "-b:a",
    `${bitrateKbps}k`,
  ];
}

export interface AssetKeyInput {
  /** videoId for youtube sources, fileKey for uploads. */
  sourceKey: string;
  startSec?: number;
  endSec?: number;
}

/**
 * Deterministic asset cache key. audioParams = SPEC_VERSION (+ the normalize
 * constants it pins). Changing any normalize parameter requires bumping
 * SPEC_VERSION, which changes every key — natural re-processing.
 */
export function buildAssetKey(input: AssetKeyInput): string {
  const audioParams = [
    `v${SPEC_VERSION}`,
    `t${NORMALIZE.silenceThresholdDb}`,
    `d${NORMALIZE.silenceMinDurationSec}`,
    `l${NORMALIZE.loudnessTargetLufs}`,
    `r${NORMALIZE.sampleRate}`,
    `c${NORMALIZE.channels}`,
    `b${NORMALIZE.bitrateKbps}`,
  ].join("_");
  const raw = [
    input.sourceKey,
    input.startSec ?? "",
    input.endSec ?? "",
    audioParams,
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

/** R2 key (private bucket) for a normalized segment asset. */
export function assetObjectKey(assetKey: string): string {
  return `assets/${assetKey}.mp3`;
}
