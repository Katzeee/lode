import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Starts the dedicated background Daemon entry.
 * Detached and unref'd: the CLI returns immediately; readiness is observed by
 * the desktop-client through Status polling while the home lock arbitrates
 * concurrent first starts.
 */
export function launchDaemon(selection: Readonly<{ name: string; path: string }>): void {
  const entryPath = fileURLToPath(new URL("../bin/lode-daemon.js", import.meta.url));
  const child = spawn(process.execPath, [entryPath, "--home", selection.path, "--home-name", selection.name], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
