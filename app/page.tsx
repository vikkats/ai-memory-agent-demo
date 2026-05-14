import { ChatMockup } from "@/components/ChatMockup";
import { CheckInPanel } from "@/components/CheckInPanel";
import { GalleryMockup } from "@/components/GalleryMockup";
import { MemoryPanel } from "@/components/MemoryPanel";
import { ProviderSettings } from "@/components/ProviderSettings";

const highlights = [
  "Provider-agnostic AI workspace",
  "Transparent vector memory retrieval",
  "Multimodal input and image gallery concepts",
  "Reviewable scheduled agent check-ins",
];

export default function Home() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Portfolio prototype</p>
          <h1>AI Memory Agent Dashboard</h1>
          <p>
            A sanitized UX/product demo for a configurable AI agent with persistent memory, provider switching,
            multimodal context, and visible retrieval controls.
          </p>
          <div className="hero-actions">
            <a href="/docs/architecture.md">Architecture notes</a>
            <a href="/docs/ux-case-study.md" className="secondary-link">
              UX case study
            </a>
          </div>
        </div>

        <div className="hero-panel">
          {highlights.map((item) => (
            <div key={item} className="highlight-row">
              <span />
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="dashboard-grid">
        <ChatMockup />
        <MemoryPanel />
        <ProviderSettings />
        <CheckInPanel />
        <GalleryMockup />
      </section>
    </main>
  );
}
