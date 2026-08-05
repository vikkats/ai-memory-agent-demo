"use client";

import { useCallback, useEffect, useState } from "react";

type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  contextWindowTokens: number;
  retrievalTopK: number;
  retrievalScoreThreshold: number;
  retrievalTokenBudget: number;
  autoIndexCadence: number;
  vectorBackend: "qdrant" | "local";
  qdrantUrl?: string | null;
  qdrantApiKey?: string | null;
  qdrantCollection?: string | null;
  toolsEnabled: boolean;
  isActive: boolean;
};

type ProvidersPayload = {
  providers: Provider[];
  vectorBackend: string;
  vectorPointCount: number;
  mockMode: boolean;
};

type MaintenanceStatus = {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  minutesSinceLastRun: number | null;
  lastStatus: string | null;
};

export function SettingsForm() {
  const [payload, setPayload] = useState<ProvidersPayload | null>(null);
  const [form, setForm] = useState<Provider | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [providersRes, maintenanceRes] = await Promise.all([
      fetch("/api/providers"),
      fetch("/api/maintenance"),
    ]);
    const providersData = (await providersRes.json()) as ProvidersPayload;
    const maintenanceData = (await maintenanceRes.json()) as { status: MaintenanceStatus };
    setPayload(providersData);
    setMaintenance(maintenanceData.status);
    const active = providersData.providers.find((p) => p.isActive) ?? providersData.providers[0];
    if (active && !form) setForm(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function update<K extends keyof Provider>(key: K, value: Provider[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveAndActivate() {
    if (!form) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "upsert", provider: form, activate: true }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Save failed.");
      setNotice("Provider saved and activated.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runMaintenance() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true, summarize: true }),
      });
      const data = (await res.json()) as {
        result?: { skippedReason?: string; steps: string[]; errors: string[] };
        error?: string;
      };
      if (!res.ok || !data.result) throw new Error(data.error ?? "Maintenance failed.");
      setNotice(
        data.result.skippedReason ??
          `Maintenance ran: ${data.result.steps.join("; ") || "no steps"}${
            data.result.errors.length ? ` — errors: ${data.result.errors.join("; ")}` : ""
          }`,
      );
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!payload || !form) return <p className="muted">Loading…</p>;

  return (
    <div>
      <section className="panel">
        <h2>Provider</h2>
        <p className="muted small">
          Status: {payload.mockMode ? "offline mock model" : "live provider"} · vector backend:{" "}
          {payload.vectorBackend} · {payload.vectorPointCount} indexed points
        </p>
        <div className="form-grid">
          <label>
            Name
            <input value={form.name} onChange={(e) => update("name", e.target.value)} />
          </label>
          <label>
            Model ID
            <input value={form.modelId} onChange={(e) => update("modelId", e.target.value)} />
          </label>
          <label className="span-2">
            Base URL (OpenAI-compatible; mock://local = offline demo model)
            <input value={form.baseUrl} onChange={(e) => update("baseUrl", e.target.value)} />
          </label>
          <label className="span-2">
            API key (leave the redacted placeholder to keep the stored key)
            <input
              type="password"
              value={form.apiKey}
              placeholder="••••••••"
              onChange={(e) => update("apiKey", e.target.value)}
            />
          </label>
          <label>
            Temperature
            <input
              type="number"
              step="0.05"
              value={form.temperature}
              onChange={(e) => update("temperature", Number(e.target.value))}
            />
          </label>
          <label>
            Top-p
            <input
              type="number"
              step="0.05"
              value={form.topP}
              onChange={(e) => update("topP", Number(e.target.value))}
            />
          </label>
          <label>
            Max reply tokens
            <input
              type="number"
              value={form.maxTokens}
              onChange={(e) => update("maxTokens", Number(e.target.value))}
            />
          </label>
          <label>
            Context window tokens
            <input
              type="number"
              value={form.contextWindowTokens}
              onChange={(e) => update("contextWindowTokens", Number(e.target.value))}
            />
          </label>
          <label>
            Retrieval top-K
            <input
              type="number"
              value={form.retrievalTopK}
              onChange={(e) => update("retrievalTopK", Number(e.target.value))}
            />
          </label>
          <label>
            Retrieval score threshold
            <input
              type="number"
              step="0.01"
              value={form.retrievalScoreThreshold}
              onChange={(e) => update("retrievalScoreThreshold", Number(e.target.value))}
            />
          </label>
          <label>
            Retrieval token budget
            <input
              type="number"
              value={form.retrievalTokenBudget}
              onChange={(e) => update("retrievalTokenBudget", Number(e.target.value))}
            />
          </label>
          <label>
            Auto-index cadence (every N turns)
            <input
              type="number"
              value={form.autoIndexCadence}
              onChange={(e) => update("autoIndexCadence", Number(e.target.value))}
            />
          </label>
          <label>
            Vector backend
            <select
              value={form.vectorBackend}
              onChange={(e) => update("vectorBackend", e.target.value as Provider["vectorBackend"])}
            >
              <option value="local">local (JSON store)</option>
              <option value="qdrant">qdrant</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.toolsEnabled}
              onChange={(e) => update("toolsEnabled", e.target.checked)}
            />
            Enable tools
          </label>
          {form.vectorBackend === "qdrant" ? (
            <>
              <label>
                Qdrant URL
                <input
                  value={form.qdrantUrl ?? ""}
                  onChange={(e) => update("qdrantUrl", e.target.value)}
                />
              </label>
              <label>
                Qdrant collection
                <input
                  value={form.qdrantCollection ?? ""}
                  onChange={(e) => update("qdrantCollection", e.target.value)}
                />
              </label>
              <label className="span-2">
                Qdrant API key
                <input
                  type="password"
                  value={form.qdrantApiKey ?? ""}
                  placeholder="••••••••"
                  onChange={(e) => update("qdrantApiKey", e.target.value)}
                />
              </label>
            </>
          ) : null}
        </div>
        <div className="toolbar">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void saveAndActivate()}>
            Save & activate
          </button>
          {notice ? <span className="muted small">{notice}</span> : null}
        </div>
      </section>

      <section className="panel">
        <h2>Maintenance</h2>
        {maintenance ? (
          <p className="muted small">
            {maintenance.enabled ? "Enabled" : "Disabled"} · interval {maintenance.intervalMinutes}m · last run:{" "}
            {maintenance.lastRunAt
              ? `${maintenance.lastRunAt.replace("T", " ").slice(0, 16)} (${Math.round(
                  maintenance.minutesSinceLastRun ?? 0,
                )}m ago)`
              : "never"}
          </p>
        ) : null}
        {maintenance?.lastStatus ? <pre className="log-block">{maintenance.lastStatus}</pre> : null}
        <div className="toolbar">
          <button type="button" className="btn" disabled={busy} onClick={() => void runMaintenance()}>
            ▶ Run maintenance (force)
          </button>
          <a className="btn" href="/api/export">
            ⬇ Export workspace (JSON)
          </a>
        </div>
      </section>
    </div>
  );
}
