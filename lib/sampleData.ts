import type { DemoGalleryItem, DemoMemory, DemoMessage, DemoProvider } from "./types";

export const demoProvider: DemoProvider = {
  name: "OpenAI-compatible provider",
  model: "memory-agent-demo-model",
  baseUrl: "https://api.example.com/v1",
  temperature: 0.82,
  contextWindow: "128k tokens",
  qdrantEnabled: true,
};

export const demoMessages: DemoMessage[] = [
  {
    id: "m1",
    role: "user",
    timestamp: "09:42",
    content: "Can you help me plan the next sprint and remember the design constraints from yesterday?",
  },
  {
    id: "m2",
    role: "assistant",
    timestamp: "09:43",
    content:
      "I found the relevant product notes: keep onboarding under three steps, expose memory controls, and make every automated action reviewable. I’d frame the sprint around trust, visibility, and recovery states.",
  },
  {
    id: "m3",
    role: "user",
    timestamp: "09:45",
    content: "Show me what context you used before we decide.",
  },
];

export const demoMemories: DemoMemory[] = [
  {
    id: "mem1",
    title: "Core UX principle",
    source: "core",
    score: 0.91,
    content: "Users should be able to inspect, edit, pin, or exclude memories that influence agent behavior.",
  },
  {
    id: "mem2",
    title: "Onboarding constraint",
    source: "note",
    score: 0.84,
    content: "First-run setup should stay under three major decisions: model provider, memory mode, and notification preference.",
  },
  {
    id: "mem3",
    title: "Scheduled actions rule",
    source: "file",
    score: 0.79,
    content: "Background check-ins should be logged, reversible, and easy to disable from settings.",
  },
];

export const demoGallery: DemoGalleryItem[] = [
  {
    id: "g1",
    title: "Uploaded reference image",
    type: "uploaded",
    description: "A user-provided screenshot used as visual context for debugging a UI state.",
  },
  {
    id: "g2",
    title: "Generated concept image",
    type: "generated",
    description: "A generated product concept saved to the gallery with metadata and notes.",
  },
  {
    id: "g3",
    title: "Moodboard item",
    type: "uploaded",
    description: "A visual reference stored for future design continuity.",
  },
];
