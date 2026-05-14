export type DemoMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

export type DemoMemory = {
  id: string;
  title: string;
  source: "core" | "conversation" | "note" | "file";
  score: number;
  content: string;
};

export type DemoProvider = {
  name: string;
  model: string;
  baseUrl: string;
  temperature: number;
  contextWindow: string;
  qdrantEnabled: boolean;
};

export type DemoGalleryItem = {
  id: string;
  title: string;
  type: "uploaded" | "generated";
  description: string;
};
