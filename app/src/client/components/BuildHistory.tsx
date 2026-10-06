import type { RoutinesDoc } from "@routinecast/shared";

/** Build history with stale/skipped flags (per-segment freshness lives on
 *  the segment rows themselves). */
export function BuildHistory(props: { doc: RoutinesDoc }) {
  const builds = [...props.doc.builds].reverse().slice(0, 14);
  if (builds.length === 0) {
    return (
      <div>
        <h2>Build history</h2>
        <p className="muted">No builds yet. Hit "Rebuild now" to produce the first episode.</p>
      </div>
    );
  }
  return (
    <div>
      <h2>Build history</h2>
      <div className="card">
        {builds.map((b) => (
          <div className="build-row" key={b.rssGuid}>
            <span>{b.date}</span>
            <span className="muted">{(b.durationMs / 60000).toFixed(1)} min</span>
            <span>
              {b.staleSegments.length > 0 && (
                <span className="badge stale" style={{ marginRight: 6 }}>
                  {b.staleSegments.length} stale
                </span>
              )}
              {b.skippedSegments.length > 0 && (
                <span className="badge skip" style={{ marginRight: 6 }}>
                  {b.skippedSegments.length} skipped
                </span>
              )}
              {b.staleSegments.length === 0 && b.skippedSegments.length === 0 && (
                <span className="badge fresh">complete</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
