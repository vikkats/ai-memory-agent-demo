import { demoMessages } from "@/lib/sampleData";

export function ChatMockup() {
  return (
    <section className="card chat-card">
      <div className="section-heading">
        <p className="eyebrow">Conversation workspace</p>
        <h2>Context-aware chat</h2>
      </div>

      <div className="chat-window">
        {demoMessages.map((message) => (
          <article key={message.id} className={`message ${message.role}`}>
            <div className="message-meta">
              <span>{message.role === "user" ? "User" : "Agent"}</span>
              <span>{message.timestamp}</span>
            </div>
            <p>{message.content}</p>
          </article>
        ))}
      </div>

      <div className="composer-mock">
        <span>Ask the agent to continue with visible memory context…</span>
        <button>Send</button>
      </div>
    </section>
  );
}
