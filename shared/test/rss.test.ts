import { describe, expect, it } from "vitest";
import { buildMp3Path, feedPath, generateRss } from "../src/rss.js";
import type { BuildRecord } from "../src/types.js";

const build: BuildRecord = {
  date: "2026-09-22",
  assetKeys: ["k1"],
  mp3Key: "token123/builds/2026-09-22-guid1.mp3",
  rssGuid: "guid1",
  durationMs: 1_230_000,
  staleSegments: [],
  skippedSegments: [],
  ffmpegVersions: {},
  builtAt: "2026-09-22T11:00:00Z",
};

const config = {
  title: "Daily Routine",
  description: "Personal feed",
  publicBaseUrl: "https://pub-abc.r2.dev",
  feedToken: "token123",
};

describe("podcast RSS", () => {
  it("paths are tokened and per-build (unique GUID defeats same-GUID staleness)", () => {
    expect(feedPath("token123")).toBe("token123/feed.xml");
    expect(buildMp3Path("token123", "2026-09-22", "guid1")).toBe(
      "token123/builds/2026-09-22-guid1.mp3",
    );
    expect(buildMp3Path("token123", "2026-09-22", "guid2")).not.toBe(
      buildMp3Path("token123", "2026-09-22", "guid1"),
    );
  });

  it("emits a single item with the build's unique GUID and enclosure", () => {
    const xml = generateRss(config, build, 12_345);
    expect(xml).toContain("<guid isPermaLink=\"false\">guid1</guid>");
    expect(xml).toContain(
      "url=\"https://pub-abc.r2.dev/token123/builds/2026-09-22-guid1.mp3\"",
    );
    expect(xml).toContain('length="12345"');
    expect(xml).toContain("<itunes:duration>20:30</itunes:duration>");
    expect(xml.match(/<item>/g)).toHaveLength(1);
  });

  it("escapes XML in titles", () => {
    const xml = generateRss({ ...config, title: "A & B <Routine>" }, build, 1);
    expect(xml).toContain("A &amp; B &lt;Routine&gt;");
  });
});
