import { getDb } from "../lib/db";
import { ensureMemoryDirs } from "../lib/memory";
import { getActiveProvider } from "../lib/providers";

/**
 * One-shot initializer: creates the SQLite schema, seeds the starter memory
 * files, and ensures an active provider exists (offline mock by default).
 */
async function main() {
  getDb();
  await ensureMemoryDirs();
  const provider = getActiveProvider();
  console.log("Workspace initialized.");
  console.log(`Active provider: ${provider?.name ?? "(none)"} (${provider?.baseUrl ?? "-"})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
