import { SettingsForm } from "@/components/SettingsForm";

export default function SettingsPage() {
  return (
    <div>
      <h1>Settings</h1>
      <p className="subtitle">
        Provider configuration, vector backend selection, maintenance controls, and workspace
        export. API keys are stored server-side and redacted in every response.
      </p>
      <SettingsForm />
    </div>
  );
}
