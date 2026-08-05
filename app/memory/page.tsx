import { MemoryBrowser } from "@/components/MemoryBrowser";

export default function MemoryPage() {
  return (
    <div>
      <h1>Memory</h1>
      <p className="subtitle">
        The agent's memory is plain Markdown on disk. Edit it directly (backups are automatic),
        review proposed edits, or rebuild the vector index.
      </p>
      <MemoryBrowser />
    </div>
  );
}
