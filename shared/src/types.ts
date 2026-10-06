/**
 * Core domain types for RoutineCast.
 *
 * All mutable state lives in a single versioned `routines.json` document in
 * the private R2 bucket. Writes go through the app's `updateRoutines()`
 * If-Match read-modify-write helper — never raw PUTs.
 */

export const SCHEMA_VERSION = 1;

/** Normalize-spec version. Bump when trim/loudnorm/output params change;
 *  asset cache keys embed it, so a bump naturally re-processes assets. */
export const SPEC_VERSION = 1;

export type SegmentId = string;

export interface YouTubeSource {
  kind: "youtube";
  /** Present for static segments and for daily segments once resolved. */
  videoId?: string;
  startSec?: number;
  endSec?: number;
}

export interface UploadSource {
  kind: "upload";
  /** R2 key of the retained original upload (private bucket). */
  fileKey: string;
  startSec?: number;
  endSec?: number;
}

export type SegmentSource = YouTubeSource | UploadSource;

export type RefreshPolicy = "static" | "daily";

export interface DailySelector {
  /** Exactly one of these identifies the candidate pool. */
  playlistId?: string;
  channelId?: string;
  query?: string;
  strategy: "latest" | "random-unplayed";
}

export interface Segment {
  id: SegmentId;
  title: string;
  source: SegmentSource;
  refresh: RefreshPolicy;
  /** Required when refresh === "daily". */
  dailySelector?: DailySelector;
}

/** Per-segment asset bookkeeping (the `assets` map on the doc). */
export interface AssetState {
  /** Cache key of the last successfully produced normalized asset. */
  lastGoodAssetKey?: string;
  /** videoIds already used by random-unplayed daily selection. */
  playedVideoIds: string[];
}

export type JobStatus = "pending" | "failed";

export interface Job {
  segmentId: SegmentId;
  /** Selector job: agent resolves to a concrete videoId (daily segments). */
  selector?: DailySelector;
  /** Direct fetch job: videoId already known (static youtube segments). */
  videoId?: string;
  startSec?: number;
  endSec?: number;
  status: JobStatus;
  attempts: number;
  lastError?: string;
  /** ISO timestamp of enqueue/last retry. */
  enqueuedAt: string;
}

export interface AgentState {
  /** ISO timestamp of the agent's most recent heartbeat/poll. */
  lastCheckInAt?: string;
}

/** Per-asset metadata recorded at ingest (D12: duration measured by decode). */
export interface AssetMeta {
  uploadedAt: string;
  durationMs: number;
  /** Who produced it: the Mac agent or the cloud app (uploads). */
  producedBy: "agent" | "app";
}

export interface BuildRecord {
  /** YYYY-MM-DD of the build. */
  date: string;
  /** Asset cache keys stitched, in order. */
  assetKeys: string[];
  /** Public-bucket key of the stitched mp3 (per-build path). */
  mp3Key: string;
  /** Unique RSS item GUID for this build. */
  rssGuid: string;
  /** Total duration of the stitched mp3 in ms. */
  durationMs: number;
  /** Segment ids built from an older last-good asset (not refreshed this cycle). */
  staleSegments: SegmentId[];
  /** Segment ids skipped because no asset exists at all. */
  skippedSegments: SegmentId[];
  /** ffmpeg versions on both sides, for forensics (D20). */
  ffmpegVersions: { app?: string; agent?: string };
  /** ISO timestamp when the build finished. */
  builtAt: string;
}

export interface RoutinesDoc {
  schemaVersion: number;
  segments: Record<SegmentId, Segment>;
  /** Ordered segment ids — the routine. */
  routine: SegmentId[];
  assets: Record<SegmentId, AssetState>;
  /** assetKey -> ingest metadata (drives chapter offsets + freshness). */
  assetIndex: Record<string, AssetMeta>;
  jobs: Job[];
  agent: AgentState;
  builds: BuildRecord[];
  /** Unguessable path token for the public feed bucket. */
  feedToken: string;
  /** Inter-segment gap in ms (0–500). */
  gapMs: number;
}

export function emptyDoc(feedToken: string): RoutinesDoc {
  return {
    schemaVersion: SCHEMA_VERSION,
    segments: {},
    routine: [],
    assets: {},
    assetIndex: {},
    jobs: [],
    agent: {},
    builds: [],
    feedToken,
    gapMs: 300,
  };
}
