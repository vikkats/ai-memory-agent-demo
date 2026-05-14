import { demoProvider } from "@/lib/sampleData";

export function ProviderSettings() {
  const rows = [
    ["Provider", demoProvider.name],
    ["Model", demoProvider.model],
    ["Base URL", demoProvider.baseUrl],
    ["Temperature", demoProvider.temperature.toString()],
    ["Context", demoProvider.contextWindow],
    ["Vector memory", demoProvider.qdrantEnabled ? "Enabled" : "Disabled"],
  ];

  return (
    <section className="card settings-card">
      <div className="section-heading">
        <p className="eyebrow">Model configuration</p>
        <h2>Provider controls</h2>
      </div>

      <div className="settings-list">
        {rows.map(([label, value]) => (
          <div key={label} className="settings-row">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
