import { demoMemories } from "@/lib/sampleData";

export function MemoryPanel() {
  return (
    <section className="card memory-card">
      <div className="section-heading">
        <p className="eyebrow">Transparent retrieval</p>
        <h2>Memory context</h2>
      </div>

      <div className="memory-list">
        {demoMemories.map((memory) => (
          <article key={memory.id} className="memory-item">
            <div className="memory-topline">
              <strong>{memory.title}</strong>
              <span>{Math.round(memory.score * 100)}%</span>
            </div>
            <p>{memory.content}</p>
            <small>{memory.source}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
