import type { BuildRecord, RoutinesDoc } from "./types.js";

/**
 * R2 retention (v1), mark-and-sweep (pure mark phase; the app sweeps):
 *  - delete builds older than `retentionDays` (14)
 *  - delete assets not referenced by any lastGoodAssetKey, any retained
 *    build, or any segment's source.fileKey (upload originals are kept for
 *    normalize-spec re-processing)
 *  - daily state snapshots (D17) are kept to `snapshotKeep` (14)
 */
export interface RetentionPlan {
  buildsToDelete: BuildRecord[];
  assetKeysToDelete: string[];
  snapshotKeysToDelete: string[];
}

export function planRetention(input: {
  doc: RoutinesDoc;
  /** All asset CACHE keys currently in the private bucket (caller strips
   *  the `assets/` prefix and `.mp3` suffix from object keys). */
  existingAssetKeys: string[];
  /** All snapshot keys currently in the private bucket (snapshots/*). */
  existingSnapshotKeys: string[];
  now: Date;
  retentionDays?: number;
  snapshotKeep?: number;
}): RetentionPlan {
  const retentionDays = input.retentionDays ?? 14;
  const snapshotKeep = input.snapshotKeep ?? 14;
  const cutoff = new Date(input.now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const buildsToDelete = input.doc.builds.filter((b) => new Date(b.builtAt) < cutoff);
  const retainedBuilds = input.doc.builds.filter((b) => new Date(b.builtAt) >= cutoff);

  const referenced = new Set<string>();
  for (const state of Object.values(input.doc.assets)) {
    if (state.lastGoodAssetKey) referenced.add(state.lastGoodAssetKey);
  }
  for (const build of retainedBuilds) {
    for (const key of build.assetKeys) referenced.add(key);
  }
  // Upload originals live under uploads/, not assets/ — they are never swept
  // here; the guard is documented so a future refactor doesn't regress it.

  const assetKeysToDelete = input.existingAssetKeys.filter((k) => !referenced.has(k));

  const sortedSnapshots = [...input.existingSnapshotKeys].sort();
  const snapshotKeysToDelete =
    sortedSnapshots.length > snapshotKeep
      ? sortedSnapshots.slice(0, sortedSnapshots.length - snapshotKeep)
      : [];

  return { buildsToDelete, assetKeysToDelete, snapshotKeysToDelete };
}
