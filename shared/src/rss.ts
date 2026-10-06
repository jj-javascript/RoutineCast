import type { BuildRecord } from "./types.js";

/**
 * Podcast RSS generation (pure). v1 feed contains only the latest build
 * item (E4 would extend to 7). Each build is a new item with a unique GUID
 * and per-build enclosure URL — same-GUID replacement silently defeats
 * podcast auto-download.
 */

export interface FeedConfig {
  title: string;
  description: string;
  /** Public base URL of the feed bucket, e.g. https://pub-xxx.r2.dev */
  publicBaseUrl: string;
  /** Unguessable path token prefixing all public paths. */
  feedToken: string;
}

export function feedPath(feedToken: string): string {
  return `${feedToken}/feed.xml`;
}

export function buildMp3Path(feedToken: string, buildDate: string, rssGuid: string): string {
  return `${feedToken}/builds/${buildDate}-${rssGuid}.mp3`;
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function generateRss(config: FeedConfig, build: BuildRecord, mp3Bytes: number): string {
  const enclosureUrl = `${config.publicBaseUrl}/${build.mp3Key}`;
  const pubDate = new Date(build.builtAt).toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${escapeXml(config.title)}</title>
    <description>${escapeXml(config.description)}</description>
    <language>en-us</language>
    <lastBuildDate>${pubDate}</lastBuildDate>
    <itunes:explicit>false</itunes:explicit>
    <item>
      <title>${escapeXml(`Routine — ${build.date}`)}</title>
      <guid isPermaLink="false">${escapeXml(build.rssGuid)}</guid>
      <pubDate>${pubDate}</pubDate>
      <enclosure url="${escapeXml(enclosureUrl)}" length="${mp3Bytes}" type="audio/mpeg"/>
      <itunes:duration>${formatDuration(build.durationMs)}</itunes:duration>
    </item>
  </channel>
</rss>
`;
}
