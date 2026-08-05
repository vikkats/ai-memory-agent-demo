import { runCheckInCycle } from "../lib/checkIns";
import { runMaintenanceCycle } from "../lib/maintenance";
import { getActiveProvider } from "../lib/providers";

/**
 * Background watcher: every interval, run one maintenance cycle and one
 * check-in cycle. In production this runs as a daemon; for the demo,
 * `npm run watcher` in a second terminal is enough.
 */
const intervalSeconds = Math.max(15, Number(process.env.AGENT_WATCHER_INTERVAL_SECONDS ?? 60));

async function tick() {
  const provider = getActiveProvider();
  if (!provider) {
    console.warn("[watcher] no active provider — skipping tick");
    return;
  }

  try {
    const maintenance = await runMaintenanceCycle(provider);
    if (maintenance.skippedReason) {
      console.log(`[watcher] maintenance skipped: ${maintenance.skippedReason}`);
    } else if (maintenance.ranAt) {
      console.log(`[watcher] maintenance ran: ${maintenance.steps.join("; ") || "no steps"}`);
      if (maintenance.errors.length) console.warn(`[watcher] maintenance errors: ${maintenance.errors.join("; ")}`);
    }
  } catch (error) {
    console.error("[watcher] maintenance failed:", error);
  }

  try {
    const checkIns = await runCheckInCycle(provider);
    if (checkIns.claimed > 0 || checkIns.recovered > 0) {
      console.log(
        `[watcher] check-ins: claimed=${checkIns.claimed} delivered=${checkIns.delivered} failed=${checkIns.failed} recovered=${checkIns.recovered}`,
      );
    }
  } catch (error) {
    console.error("[watcher] check-in cycle failed:", error);
  }
}

console.log(`[watcher] starting — tick every ${intervalSeconds}s`);
void tick();
setInterval(() => void tick(), intervalSeconds * 1000);
