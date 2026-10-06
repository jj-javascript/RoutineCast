import type { RoutinesDoc } from "@routinecast/shared";

/** Agent check-in + pending job status. "Fresh" means resolved within this
 *  build cycle (D21) — daily resolution lags up to one cycle by design. */
export function StatusPanel(props: { doc: RoutinesDoc }) {
  const { doc } = props;
  const last = doc.agent.lastCheckInAt;
  const hoursAgo = last ? (Date.now() - new Date(last).getTime()) / 3_600_000 : null;
  const agentOk = hoursAgo !== null && hoursAgo <= 24;
  const pendingJobs = doc.jobs.filter((j) => j.status === "pending");
  const failedJobs = doc.jobs.filter((j) => j.status === "failed");
  const hasDaily = Object.values(doc.segments).some((s) => s.refresh === "daily");

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="build-row">
        <span>Mac fetch agent</span>
        {hasDaily ? (
          <span className={`badge ${agentOk ? "fresh" : "stale"}`}>
            {last
              ? agentOk
                ? `checked in ${Math.max(0, Math.round(hoursAgo))}h ago`
                : `offline — last seen ${Math.round(hoursAgo)}h ago`
              : "never checked in"}
          </span>
        ) : (
          <span className="badge">not needed (no daily segments)</span>
        )}
      </div>
      <div className="build-row">
        <span>Pending fetch jobs</span>
        <span className="badge">{pendingJobs.length}</span>
      </div>
      {failedJobs.length > 0 && (
        <div className="build-row">
          <span>Failed jobs</span>
          <span className="badge skip" title={failedJobs.map((j) => j.lastError).join("\n")}>
            {failedJobs.length} — hover for reason
          </span>
        </div>
      )}
    </div>
  );
}
