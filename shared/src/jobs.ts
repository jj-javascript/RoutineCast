import type { Job, Segment } from "./types.js";

/**
 * Job queue helpers (pure). Jobs live on the routines doc in R2 so they
 * survive host spin-down. Enqueue is an UPSERT (D24): a new job for a
 * segment replaces any pending one — race-safe inside updateRoutines().
 */

export const MAX_JOB_ATTEMPTS = 3;

export function jobForSegment(segment: Segment, now: string): Job | null {
  const base = {
    segmentId: segment.id,
    status: "pending" as const,
    attempts: 0,
    enqueuedAt: now,
    ...(segment.source.startSec !== undefined ? { startSec: segment.source.startSec } : {}),
    ...(segment.source.endSec !== undefined ? { endSec: segment.source.endSec } : {}),
  };
  if (segment.refresh === "daily") {
    if (!segment.dailySelector) return null;
    return { ...base, selector: segment.dailySelector };
  }
  if (segment.source.kind === "youtube") {
    if (!segment.source.videoId) return null;
    return { ...base, videoId: segment.source.videoId };
  }
  // Upload segments are normalized cloud-side at upload time — no agent job.
  return null;
}

/** Upsert: replace any existing job for this segment (D24). */
export function upsertJob(jobs: Job[], job: Job): Job[] {
  return [...jobs.filter((j) => j.segmentId !== job.segmentId), job];
}

export function removeJob(jobs: Job[], segmentId: string): Job[] {
  return jobs.filter((j) => j.segmentId !== segmentId);
}

/** Record a failed attempt; mark permanently failed after MAX_JOB_ATTEMPTS (D9). */
export function failJob(job: Job, error: string, now: string): Job {
  const attempts = job.attempts + 1;
  return {
    ...job,
    attempts,
    lastError: error,
    enqueuedAt: now,
    status: attempts >= MAX_JOB_ATTEMPTS ? "failed" : "pending",
  };
}

/** Which segments need jobs at end-of-build: all daily segments (steady state). */
export function segmentsNeedingRefresh(segments: Segment[]): Segment[] {
  return segments.filter((s) => s.refresh === "daily");
}
