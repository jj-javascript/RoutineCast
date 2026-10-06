import { describe, expect, it } from "vitest";
import {
  failJob,
  jobForSegment,
  MAX_JOB_ATTEMPTS,
  removeJob,
  segmentsNeedingRefresh,
  upsertJob,
} from "../src/jobs.js";
import type { Job, Segment } from "../src/types.js";

const now = "2026-09-22T12:00:00Z";

const dailySeg: Segment = {
  id: "d1",
  title: "Daily",
  source: { kind: "youtube", startSec: 5, endSec: 200 },
  refresh: "daily",
  dailySelector: { playlistId: "PL1", strategy: "random-unplayed" },
};

const staticSeg: Segment = {
  id: "s1",
  title: "Static",
  source: { kind: "youtube", videoId: "v1" },
  refresh: "static",
};

const uploadSeg: Segment = {
  id: "u1",
  title: "Upload",
  source: { kind: "upload", fileKey: "uploads/x.mp3" },
  refresh: "static",
};

describe("jobForSegment", () => {
  it("daily segments produce SELECTOR jobs (agent resolves the videoId)", () => {
    const job = jobForSegment(dailySeg, now)!;
    expect(job.selector).toEqual(dailySeg.dailySelector);
    expect(job.videoId).toBeUndefined();
    expect(job.startSec).toBe(5);
    expect(job.endSec).toBe(200);
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);
  });

  it("static youtube segments produce direct videoId jobs", () => {
    const job = jobForSegment(staticSeg, now)!;
    expect(job.videoId).toBe("v1");
    expect(job.selector).toBeUndefined();
  });

  it("upload segments produce no agent job (normalized cloud-side)", () => {
    expect(jobForSegment(uploadSeg, now)).toBeNull();
  });
});

describe("upsertJob (D24 dedup)", () => {
  it("replaces any existing job for the same segment", () => {
    const j1 = jobForSegment(staticSeg, now)!;
    const j2 = { ...jobForSegment(staticSeg, now)!, attempts: 2 };
    const jobs = upsertJob([j1], j2);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.attempts).toBe(2);
  });

  it("keeps jobs for other segments", () => {
    const j1 = jobForSegment(staticSeg, now)!;
    const j2 = jobForSegment(dailySeg, now)!;
    expect(upsertJob([j1], j2)).toHaveLength(2);
  });
});

describe("failJob lifecycle (D9)", () => {
  it("stays pending below the attempt cap, carrying lastError", () => {
    const job = jobForSegment(staticSeg, now)!;
    const failed = failJob(job, "yt-dlp 403", now);
    expect(failed.attempts).toBe(1);
    expect(failed.status).toBe("pending");
    expect(failed.lastError).toBe("yt-dlp 403");
  });

  it("marks permanently failed at the attempt cap", () => {
    let job = jobForSegment(staticSeg, now)!;
    for (let i = 0; i < MAX_JOB_ATTEMPTS; i++) job = failJob(job, `err ${i}`, now);
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(MAX_JOB_ATTEMPTS);
  });
});

describe("removeJob / segmentsNeedingRefresh", () => {
  it("removes by segment id", () => {
    const jobs = [jobForSegment(staticSeg, now)!, jobForSegment(dailySeg, now)!];
    expect(removeJob(jobs, "s1").map((j) => j.segmentId)).toEqual(["d1"]);
  });

  it("end-of-build refresh covers exactly the daily segments", () => {
    expect(segmentsNeedingRefresh([staticSeg, dailySeg, uploadSeg])).toEqual([dailySeg]);
  });
});
