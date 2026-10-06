import { describe, expect, it } from "vitest";
import { parseRoutinesDoc, segmentInputSchema } from "../src/schema.js";
import { emptyDoc, SCHEMA_VERSION } from "../src/types.js";

describe("migrate-on-read", () => {
  it("parses a current-version doc", () => {
    const doc = emptyDoc("t".repeat(20));
    const parsed = parseRoutinesDoc(JSON.parse(JSON.stringify(doc)));
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.gapMs).toBe(300);
  });

  it("migrates a pre-versioning (v0) doc, defaulting new fields", () => {
    const legacy = {
      segments: {},
      routine: [],
      assets: {},
      feedToken: "t".repeat(20),
    };
    const parsed = parseRoutinesDoc(legacy);
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.jobs).toEqual([]);
    expect(parsed.builds).toEqual([]);
    expect(parsed.assetIndex).toEqual({});
  });

  it("rejects docs from a newer schema version", () => {
    const doc = { ...emptyDoc("t".repeat(20)), schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => parseRoutinesDoc(JSON.parse(JSON.stringify(doc)))).toThrow(/newer/);
  });

  it("rejects invalid docs", () => {
    expect(() => parseRoutinesDoc({ schemaVersion: 1 })).toThrow(/validation/);
    expect(() => parseRoutinesDoc("nope")).toThrow(/not an object/);
  });

  it("enforces exactly one selector source", () => {
    const doc = emptyDoc("t".repeat(20));
    doc.segments = {
      s1: {
        id: "s1",
        title: "x",
        source: { kind: "youtube" },
        refresh: "daily",
        dailySelector: {
          playlistId: "PL1",
          query: "both set — invalid",
          strategy: "latest",
        },
      },
    };
    expect(() => parseRoutinesDoc(JSON.parse(JSON.stringify(doc)))).toThrow(/validation/);
  });

  it("segmentInputSchema accepts a create payload without id", () => {
    const parsed = segmentInputSchema.parse({
      title: "warmup",
      source: { kind: "youtube", videoId: "abc" },
      refresh: "static",
    });
    expect(parsed.title).toBe("warmup");
  });
});
