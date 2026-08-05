import { CheckInManager } from "@/components/CheckInManager";

export default function CheckInsPage() {
  return (
    <div>
      <h1>Check-ins</h1>
      <p className="subtitle">
        Scheduled agent-initiated messages. The watcher claims due items atomically, dedupes by
        occurrence, and reschedules recurring items.
      </p>
      <CheckInManager />
    </div>
  );
}
