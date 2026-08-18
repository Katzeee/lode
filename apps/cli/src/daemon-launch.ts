import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Re-invokes the current `lode` executable in its background Daemon mode.
 * Detached and unref'd: the CLI returns immediately; readiness is observed by
 * the desktop-client through Status polling while the home lock arbitrates
 * concurrent first starts.
 */
export function launchDaemon(selection: Readonly<{ name: string; path: string }>): void {
  const source = fileURLToPath(import.meta.url);
  const compiled = !source.endsWith(".ts");
  // tsc preserves the src layout into dist, so the bin is a sibling in both.
  const entry = new URL(compiled ? "./bin/lode.js" : "./bin/lode.ts", import.meta.url);
  const entryPath = fileURLToPath(entry);
  const argv = compiled ? [entryPath] : [createRequire(source).resolve("tsx/dist/cli.mjs"), entryPath];
  const child = spawn(
    process.execPath,
    [...argv, "--internal-daemon", "--home", selection.path, "--home-name", selection.name],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
}
