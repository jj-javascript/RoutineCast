import type { DailySelector } from "./types.js";

/**
 * Daily-selector pool logic (pure). The agent resolves the selector to a
 * candidate list via yt-dlp metadata, then picks through this function.
 *
 * random-unplayed pool reset: when every candidate is already in
 * playedVideoIds, the pool resets (caller clears playedVideoIds for the
 * segment and selects again). If the selector still returns nothing, the
 * segment is skip-and-flagged at the next build.
 */
export interface SelectionResult {
  videoId: string | null;
  /** True when the pick required resetting the played pool. */
  poolReset: boolean;
}

export function selectFromPool(
  selector: DailySelector,
  candidateVideoIds: string[],
  playedVideoIds: string[],
  random: () => number = Math.random,
): SelectionResult {
  if (candidateVideoIds.length === 0) return { videoId: null, poolReset: false };

  if (selector.strategy === "latest") {
    // yt-dlp returns playlist/channel/query results newest-first.
    return { videoId: candidateVideoIds[0]!, poolReset: false };
  }

  const played = new Set(playedVideoIds);
  let pool = candidateVideoIds.filter((id) => !played.has(id));
  let poolReset = false;
  if (pool.length === 0) {
    pool = candidateVideoIds;
    poolReset = true;
  }
  const idx = Math.floor(random() * pool.length) % pool.length;
  return { videoId: pool[idx]!, poolReset };
}
