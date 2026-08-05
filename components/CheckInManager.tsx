"use client";

import { useCallback, useEffect, useState } from "react";

type CheckIn = {
  id: string;
  title: string;
  intent: string;
  fallbackMessage: string;
  dueAt: string;
  timezone: string;
  recurrence: "none" | "daily" | "weekly";
  status: "pending" | "processing" | "fired" | "cancelled";
  occurrenceCount: number;
  firedAt: string | null;
  lastError: string | null;
};

type CycleResult = {
  claimed: number;
  delivered: number;
  recovered: number;
  failed: number;
  results: Array<{ checkInId: string; title: string; delivered: boolean; error?: string; rescheduledTo?: string }>;
};

function statusBadge(status: CheckIn["status"]) {
  if (status === "pending") return "badge blue";
  if (status === "processing") return "badge amber";
  if (status === "fired") return "badge green";
  return "badge";
}

export function CheckInManager() {
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("");
  const [fallbackMessage, setFallbackMessage] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [recurrence, setRecurrence] = useState<CheckIn["recurrence"]>("none");
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/checkins");
    const data = (await res.json()) as { checkIns: CheckIn[] };
    setCheckIns(data.checkIns ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    if (!title.trim() || !intent.trim() || !fallbackMessage.trim() || !dueAt) return;
    setBusy(true);
    try {
      const res = await fetch("/api/checkins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          intent,
          fallbackMessage,
          dueAt: new Date(dueAt).toISOString(),
          recurrence,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Create failed.");
      setTitle("");
      setIntent("");
      setFallbackMessage("");
      setDueAt("");
      setRecurrence("none");
      setLog(null);
      await refresh();
    } catch (error) {
      setLog(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    await fetch(`/api/checkins?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }

  async function runCycle() {
    setBusy(true);
    try {
      const res = await fetch("/api/checkins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      const data = (await res.json()) as { result?: CycleResult; error?: string };
      if (!res.ok || !data.result) throw new Error(data.error ?? "Cycle failed.");
      setLog(JSON.stringify(data.result, null, 2));
      await refresh();
    } catch (error) {
      setLog(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="panel">
        <h2>Schedule a check-in</h2>
        <div className="form-grid">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Standup reminder" />
          </label>
          <label>
            Due at
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </label>
          <label className="span-2">
            Intent (what the agent should try to do)
            <input
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="Ask how the migration went and offer to summarize the thread"
            />
          </label>
          <label className="span-2">
            Fallback message (used in offline mode or on model failure)
            <input
              value={fallbackMessage}
              onChange={(e) => setFallbackMessage(e.target.value)}
              placeholder="Checking in as scheduled — how did the migration go?"
            />
          </label>
          <label>
            Recurrence
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as CheckIn["recurrence"])}>
              <option value="none">none</option>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
            </select>
          </label>
        </div>
        <div className="toolbar">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void create()}>
            Schedule
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void runCycle()}>
            ▶ Run cycle now
          </button>
        </div>
        {log ? <pre className="log-block">{log}</pre> : null}
      </section>

      <section className="panel">
        <h2>Scheduled ({checkIns.length})</h2>
        {checkIns.length === 0 ? (
          <p className="muted">Nothing scheduled. In production the watcher script runs cycles on an interval.</p>
        ) : (
          checkIns.map((checkIn) => (
            <div key={checkIn.id} className="checkin-row">
              <div>
                <strong>{checkIn.title}</strong>
                <div className="muted small">
                  due {checkIn.dueAt.replace("T", " ").slice(0, 16)} ({checkIn.timezone}) · recurrence:{" "}
                  {checkIn.recurrence} · delivered {checkIn.occurrenceCount}×
                </div>
                {checkIn.lastError ? <div className="small error-text">{checkIn.lastError}</div> : null}
              </div>
              <div className="toolbar">
                <span className={statusBadge(checkIn.status)}>{checkIn.status}</span>
                {checkIn.status === "pending" || checkIn.status === "processing" ? (
                  <button type="button" className="btn danger" onClick={() => void cancel(checkIn.id)}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
