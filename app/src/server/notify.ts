import type { WatchdogAlert } from "@routinecast/shared";
import type { AppConfig } from "./config.js";

/**
 * Health notifications (E5). ntfy.sh covers explicit failures and degraded
 * builds; healthchecks.io is the dead-man's switch pinged ONLY after the
 * mp3 + RSS for a run are fully written — it catches "never finished"
 * (Actions schedule slip, 60-day auto-disable, Render down).
 */
export interface Notifier {
  sendAlerts(alerts: WatchdogAlert[]): Promise<void>;
  pingDeadMansSwitch(): Promise<void>;
}

export class HttpNotifier implements Notifier {
  constructor(private config: AppConfig) {}

  async sendAlerts(alerts: WatchdogAlert[]): Promise<void> {
    if (!this.config.ntfyTopic || alerts.length === 0) return;
    for (const alert of alerts) {
      const res = await fetch(`https://ntfy.sh/${this.config.ntfyTopic}`, {
        method: "POST",
        headers: { Title: alert.title, Priority: alert.kind === "build-failed" ? "high" : "default" },
        body: alert.message,
      });
      if (!res.ok) {
        // Notification failure must never crash the build — log and continue.
        console.error(`ntfy publish failed: ${res.status} ${await res.text()}`);
      }
    }
  }

  async pingDeadMansSwitch(): Promise<void> {
    if (!this.config.healthchecksPingUrl) return;
    const res = await fetch(this.config.healthchecksPingUrl, { method: "POST" });
    if (!res.ok) {
      console.error(`healthchecks ping failed: ${res.status}`);
    }
  }
}

/** Test/dev notifier: records calls, no network. */
export class FakeNotifier implements Notifier {
  alerts: WatchdogAlert[] = [];
  deadMansPings = 0;
  async sendAlerts(alerts: WatchdogAlert[]): Promise<void> {
    this.alerts.push(...alerts);
  }
  async pingDeadMansSwitch(): Promise<void> {
    this.deadMansPings++;
  }
}
