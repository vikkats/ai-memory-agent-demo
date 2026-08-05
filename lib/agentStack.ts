import type { MemoryFile } from "./types";
import { listMemoryFiles } from "./memory";
import { estimateTokens } from "./tokens";

/**
 * The agent stack is the layered system-prompt body assembled from memory
 * files. Order is deliberate: identity and behavior first, current state
 * last, so the most volatile context sits closest to the conversation.
 */

type StackSection = {
  title: string;
  files: MemoryFile[];
};

const STACK_SOURCE_PATHS = {
  orientation: ["core/START_HERE.md"],
  identity: ["core/agent_identity.md"],
  behavior: ["core/behavior_guidelines.md"],
  principles: ["core/product_principles.md"],
  liveState: ["core/live_state.md"],
} as const;

function filesByPath(files: MemoryFile[]) {
  return new Map<string, MemoryFile>(files.map((file) => [file.path, file] as const));
}

function existingFiles(paths: readonly string[], fileMap: Map<string, MemoryFile>) {
  return paths
    .map((sourcePath) => fileMap.get(sourcePath))
    .filter((file): file is MemoryFile => Boolean(file));
}

function formatSection(section: StackSection) {
  const sources = section.files
    .map((file) => [`Source: ${file.path}`, "", file.content.trim()].join("\n"))
    .filter((source) => source.trim().length > 0);

  if (!sources.length) return "";
  return [`[${section.title}]`, ...sources].join("\n\n");
}

function buildSections(files: MemoryFile[]): StackSection[] {
  const fileMap = filesByPath(files);
  return [
    { title: "RUNTIME ORIENTATION", files: existingFiles(STACK_SOURCE_PATHS.orientation, fileMap) },
    { title: "IDENTITY", files: existingFiles(STACK_SOURCE_PATHS.identity, fileMap) },
    { title: "BEHAVIOR GUIDELINES", files: existingFiles(STACK_SOURCE_PATHS.behavior, fileMap) },
    { title: "PRODUCT PRINCIPLES", files: existingFiles(STACK_SOURCE_PATHS.principles, fileMap) },
    { title: "LIVE STATE", files: existingFiles(STACK_SOURCE_PATHS.liveState, fileMap) },
  ];
}

export async function loadAgentStackForPrompt(maxTokens = Number.POSITIVE_INFINITY) {
  const files = await listMemoryFiles();
  const sections = buildSections(files)
    .map(formatSection)
    .filter((section) => section.trim().length > 0);

  const selectedSections: string[] = [];
  let usedTokens = 0;
  let skippedSections = 0;

  for (const section of sections) {
    const sectionTokens = estimateTokens(section);

    if (Number.isFinite(maxTokens) && selectedSections.length > 0 && usedTokens + sectionTokens > maxTokens) {
      skippedSections += 1;
      continue;
    }

    selectedSections.push(section);
    usedTokens += sectionTokens;
  }

  if (skippedSections > 0) {
    selectedSections.push(
      `[AGENT STACK NOTE]\n${skippedSections} section(s) were not injected because the context window budget was reached.`,
    );
  }

  return selectedSections.join("\n\n---\n\n");
}
