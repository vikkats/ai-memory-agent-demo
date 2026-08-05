import { ChatClient } from "@/components/ChatClient";

export default function ChatPage() {
  return (
    <div>
      <h1>Chat</h1>
      <p className="subtitle">
        Talk to the agent. Expand any answer to see the retrieved memories, scores, and tool calls
        that produced it.
      </p>
      <ChatClient />
    </div>
  );
}
