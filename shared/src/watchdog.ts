import type { BuildRecord, RoutinesDoc } from "./types.js";

/**
 * Watchdog rules (pure). Evaluated on the daily cron ping; each rule
 * produces an ntfy notification. healthchecks.io is pinged separately,
 * only after mp3+RSS are written (dead-man's switch for "never finished").
 */
export interface WatchdogAlert {
  kind: "agent-missed-checkin" | "build-failed" | "build-degraded";
  title: string;
  message: string;
}

export const AGENT_CHECKIN_LIMIT_MS = 24 * 60 * 60 * 1000;

export function evaluateWatchdog(input: {
  doc: RoutinesDoc;
  now: Date;
  /** The build that just ran, or null if the build failed before producing a record. */
  buildResult: BuildRecord | null;
  buildError?: string;
}): WatchdogAlert[] {
  const alerts: WatchdogAlert[] = [];
  const { doc, now, buildResult, buildError } = input;

  // Rule 1: agent missed check-in > 24h.
  const last = doc.agent.lastCheckInAt;
  if (!last || now.getTime() - new Date(last).getTime() > AGENT_CHECKIN_LIMIT_MS) {
    const hasDaily = Object.values(doc.segments).some((s) => s.refresh === "daily");
    if (hasDaily) {
      alerts.push({
        kind: "agent-missed-checkin",
        title: "RoutineCast: fetch agent offline",
        message: last
          ? `Mac agent last checked in ${last} (>24h ago). Daily segments will use stale audio.`
          : "Mac agent has never checked in. Daily segments cannot refresh.",
      });
    }
  }

  // Rule 2: build failed.
  if (buildError !== undefined) {
    alerts.push({
      kind: "build-failed",
      title: "RoutineCast: build failed",
      message: `Today's build failed: ${buildError}. Yesterday's episode remains in the feed.`,
    });
    return alerts; // no build record -> rule 3 can't apply
  }

  // Rule 3: build succeeded but degraded (stale fallback or skipped segments).
  if (buildResult && (buildResult.staleSegments.length > 0 || buildResult.skippedSegments.length > 0)) {
    const parts: string[] = [];
    if (buildResult.staleSegments.length > 0) {
      const titles = buildResult.staleSegments.map((id) => doc.segments[id]?.title ?? id);
      parts.push(`stale (previous audio reused): ${titles.join(", ")}`);
    }
    if (buildResult.skippedSegments.length > 0) {
      const titles = buildResult.skippedSegments.map((id) => doc.segments[id]?.title ?? id);
      parts.push(`skipped (no audio available): ${titles.join(", ")}`);
    }
    alerts.push({
      kind: "build-degraded",
      title: "RoutineCast: build completed with gaps",
      message: `Today's episode built, but ${parts.join("; ")}.`,
    });
  }

  return alerts;
}
