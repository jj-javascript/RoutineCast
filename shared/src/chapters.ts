/**
 * Chapter offset computation (pure). Chapter start offset = cumulative
 * post-trim durations PLUS accumulated inter-segment gaps (spec review
 * iteration 2, issue 4). Durations come from ingest-time decode
 * measurements (D12) — never header metadata.
 */

export interface ChapterInput {
  title: string;
  /** Sample-accurate duration measured at ingest, ms. */
  durationMs: number;
}

export interface Chapter {
  title: string;
  startMs: number;
  endMs: number;
}

export function computeChapters(segments: ChapterInput[], gapMs: number): Chapter[] {
  const chapters: Chapter[] = [];
  let cursor = 0;
  for (const seg of segments) {
    chapters.push({ title: seg.title, startMs: cursor, endMs: cursor + seg.durationMs });
    cursor += seg.durationMs + gapMs;
  }
  return chapters;
}

/** Total duration of the stitched file (last chapter end; no trailing gap). */
export function totalDurationMs(segments: ChapterInput[], gapMs: number): number {
  if (segments.length === 0) return 0;
  const chapters = computeChapters(segments, gapMs);
  return chapters[chapters.length - 1]!.endMs;
}
