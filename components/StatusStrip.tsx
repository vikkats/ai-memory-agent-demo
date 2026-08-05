"use client";

import { useEffect, useState } from "react";

type ProviderStatus = {
  providers: Array<{ id: string; name: string; modelId: string; isActive: boolean }>;
  vectorBackend: string;
  vectorPointCount: number;
  mockMode: boolean;
};

export function StatusStrip() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);

  useEffect(() => {
    fetch("/api/providers")
      .then((res) => res.json())
      .then((data: ProviderStatus) => setStatus(data))
      .catch(() => setStatus(null));
  }, []);

  if (!status) return null;

  const active = status.providers.find((p) => p.isActive);

  return (
    <div className="status-strip">
      <span className={status.mockMode ? "badge amber" : "badge green"}>
        {status.mockMode ? "offline mock model" : "live provider"}
      </span>
      {active ? <span className="badge blue">{active.name}</span> : null}
      <span className="badge">vector: {status.vectorBackend}</span>
      <span className="badge">{status.vectorPointCount} indexed points</span>
    </div>
  );
}
