import { z } from "zod";
import {
  SCHEMA_VERSION,
  type RoutinesDoc,
  emptyDoc,
} from "./types.js";

const dailySelectorSchema = z
  .object({
    playlistId: z.string().min(1).optional(),
    channelId: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    strategy: z.enum(["latest", "random-unplayed"]),
  })
  .refine(
    (s) => [s.playlistId, s.channelId, s.query].filter(Boolean).length === 1,
    { message: "exactly one of playlistId, channelId, query" },
  );

const segmentObjectSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  source: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("youtube"),
      videoId: z.string().min(1).optional(),
      startSec: z.number().nonnegative().optional(),
      endSec: z.number().nonnegative().optional(),
    }),
    z.object({
      kind: z.literal("upload"),
      fileKey: z.string().min(1),
      startSec: z.number().nonnegative().optional(),
      endSec: z.number().nonnegative().optional(),
    }),
  ]),
  refresh: z.enum(["static", "daily"]),
  dailySelector: dailySelectorSchema.optional(),
});

type SegmentFields = z.infer<typeof segmentObjectSchema>;

function withSegmentRules<T extends z.ZodType>(schema: T) {
  return schema
    .refine(
      (s) => {
        const seg = s as Pick<SegmentFields, "refresh" | "dailySelector">;
        return seg.refresh !== "daily" || seg.dailySelector !== undefined;
      },
      { message: "daily segments require dailySelector" },
    )
    .refine(
      (s) => {
        const seg = s as Pick<SegmentFields, "source">;
        return (
          seg.source.startSec === undefined ||
          seg.source.endSec === undefined ||
          seg.source.endSec > seg.source.startSec
        );
      },
      { message: "endSec must be after startSec" },
    );
}

const segmentInputObject = segmentObjectSchema.omit({ id: true });

const segmentSchema = withSegmentRules(segmentObjectSchema);
const segmentInputSchema = withSegmentRules(segmentInputObject);

const jobSchema = z
  .object({
    segmentId: z.string().min(1),
    selector: dailySelectorSchema.optional(),
    videoId: z.string().min(1).optional(),
    startSec: z.number().nonnegative().optional(),
    endSec: z.number().nonnegative().optional(),
    status: z.enum(["pending", "failed"]),
    attempts: z.number().int().nonnegative(),
    lastError: z.string().optional(),
    enqueuedAt: z.string(),
  })
  .refine((j) => j.selector !== undefined || j.videoId !== undefined, {
    message: "job needs a selector or a videoId",
  });

const buildRecordSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assetKeys: z.array(z.string()),
  mp3Key: z.string().min(1),
  rssGuid: z.string().min(1),
  durationMs: z.number().nonnegative(),
  staleSegments: z.array(z.string()),
  skippedSegments: z.array(z.string()),
  ffmpegVersions: z.object({
    app: z.string().optional(),
    agent: z.string().optional(),
  }),
  builtAt: z.string(),
});

export const routinesDocSchema = z.object({
  schemaVersion: z.number().int().positive(),
  segments: z.record(segmentSchema),
  routine: z.array(z.string()),
  assets: z.record(
    z.object({
      lastGoodAssetKey: z.string().optional(),
      playedVideoIds: z.array(z.string()),
    }),
  ),
  assetIndex: z.record(
    z.object({
      uploadedAt: z.string(),
      durationMs: z.number().positive(),
      producedBy: z.enum(["agent", "app"]),
    }),
  ),
  jobs: z.array(jobSchema),
  agent: z.object({ lastCheckInAt: z.string().optional() }),
  builds: z.array(buildRecordSchema),
  feedToken: z.string().min(16),
  gapMs: z.number().int().min(0).max(500),
});

export { dailySelectorSchema, segmentSchema, segmentInputSchema, jobSchema };

/**
 * Migrate-on-read (D8): parse any historical doc shape into the current
 * schema. Each migration step is a pure function doc(N) -> doc(N+1).
 * Add steps here when SCHEMA_VERSION bumps; never edit old steps.
 */
const migrations: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  // 0 -> 1: the initial versioned shape. Pre-versioning docs had no
  // schemaVersion, no jobs/agent/builds fields.
  0: (doc) => ({
    ...emptyDoc(typeof doc.feedToken === "string" ? doc.feedToken : crypto.randomUUID().replaceAll("-", "")),
    ...doc,
    schemaVersion: 1,
    jobs: Array.isArray(doc.jobs) ? doc.jobs : [],
    agent: typeof doc.agent === "object" && doc.agent !== null ? doc.agent : {},
    builds: Array.isArray(doc.builds) ? doc.builds : [],
    assetIndex:
      typeof doc.assetIndex === "object" && doc.assetIndex !== null ? doc.assetIndex : {},
    gapMs: typeof doc.gapMs === "number" ? doc.gapMs : 300,
  }),
};

export function parseRoutinesDoc(raw: unknown): RoutinesDoc {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("routines.json is not an object");
  }
  let doc = raw as Record<string, unknown>;
  let version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `routines.json schemaVersion ${version} is newer than this app supports (${SCHEMA_VERSION})`,
    );
  }
  while (version < SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) throw new Error(`no migration path from schemaVersion ${version}`);
    doc = migrate(doc);
    version = doc.schemaVersion as number;
  }
  const parsed = routinesDocSchema.safeParse(doc);
  if (!parsed.success) {
    throw new Error(`routines.json failed validation: ${parsed.error.message}`);
  }
  return parsed.data as RoutinesDoc;
}
