import { spawn } from "node:child_process";
import type { HomeSelection } from "@lode/desktop-client";
import type { OwnedDaemon, OwnedDaemonExit } from "./authority.js";
export async function spawnDaemonProcess(
  selection: HomeSelection,
  entry: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<OwnedDaemon> {
  const child = spawn(process.execPath, [entry, "--home", selection.path, "--home-name", selection.name], {
    cwd: selection.path,
    env: environment,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  const exit = new Promise<OwnedDaemonExit>((resolve) => {
    child.once("exit", (code) => resolve({ code: code ?? 1, output: "" }));
    child.once("error", (error) => resolve({ code: 1, output: error.message }));
  });
  const pid = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () =>
      child.pid === undefined ? reject(new Error("Daemon PID is missing")) : resolve(child.pid),
    );
  });
  child.unref();
  return {
    pid,
    exit,
    terminate: async () => {
      child.kill();
      return exit;
    },
  };
}
