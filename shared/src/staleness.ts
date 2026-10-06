import type { AssetMeta, AssetState, Segment } from "./types.js";
import { buildAssetKey } from "./normalize.js";

/**
 * Freshness classification at build time (D21):
 *  - "fresh":        static segment with an existing asset, OR daily segment
 *                    whose asset was resolved/uploaded this build cycle.
 *  - "stale":        daily segment falling back to an older last-good asset.
 *  - "skip":         no asset exists at all — segment is skipped and flagged.
 *
 * "This build cycle" is bounded by `cycleStart` (the previous build's finish
 * time; daily jobs enqueue at end-of-build, so resolution lags up to one
 * cycle by design — inherent to the opportunistic agent model).
 */
export type Freshness = "fresh" | "stale" | "skip";

export interface ClassifyInput {
  segment: Segment;
  assetState: AssetState | undefined;
  /** ISO timestamp of the previous build's completion (cycle boundary). */
  cycleStart: string | null;
  /** The doc's asset index (assetKey -> ingest metadata). */
  assetIndex: Record<string, AssetMeta>;
}

export function classifySegment(input: ClassifyInput): { freshness: Freshness; assetKey?: string } {
  const { segment, assetState, cycleStart, assetIndex } = input;
  const lastGood = assetState?.lastGoodAssetKey;
  if (!lastGood) return { freshness: "skip" };

  if (segment.refresh === "static") {
    return { freshness: "fresh", assetKey: lastGood };
  }

  // Daily: fresh iff the last-good asset was uploaded this cycle.
  const uploadedAt = assetIndex[lastGood]?.uploadedAt;
  const isThisCycle =
    uploadedAt !== undefined && (cycleStart === null || uploadedAt > cycleStart);
  return isThisCycle
    ? { freshness: "fresh", assetKey: lastGood }
    : { freshness: "stale", assetKey: lastGood };
}

/**
 * The asset key a job should produce. For selector jobs the videoId is
 * resolved by the agent first, then this key is computed from the resolved id.
 */
export function expectedAssetKeyForSegment(segment: Segment, resolvedVideoId?: string): string | null {
  if (segment.source.kind === "upload") {
    return buildAssetKey({
      sourceKey: segment.source.fileKey,
      ...(segment.source.startSec !== undefined ? { startSec: segment.source.startSec } : {}),
      ...(segment.source.endSec !== undefined ? { endSec: segment.source.endSec } : {}),
    });
  }
  const videoId = resolvedVideoId ?? segment.source.videoId;
  if (!videoId) return null;
  return buildAssetKey({
    sourceKey: videoId,
    ...(segment.source.startSec !== undefined ? { startSec: segment.source.startSec } : {}),
    ...(segment.source.endSec !== undefined ? { endSec: segment.source.endSec } : {}),
  });
}
