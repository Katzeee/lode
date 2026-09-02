import { app, utilityProcess, type UtilityProcess } from "electron";
import { join } from "node:path";

import type { HomeSelection } from "@lode/desktop-client";

import type { OwnedDaemon, OwnedDaemonExit } from "./authority.js";

const STOP_TIMEOUT_MS = 10_000;

export async function spawnPackagedDaemon(selection: HomeSelection): Promise<OwnedDaemon> {
  const modulePath = join(app.getAppPath(), "dist", "daemon.js");
  const child = utilityProcess.fork(modulePath, ["--home", selection.path, "--home-name", selection.name], {
    cwd: selection.path,
    env: process.env,
    serviceName: `Lode Engine (${selection.name})`,
    stdio: "pipe",
  });
  const output: string[] = [];
  child.stdout?.on("data", (chunk: Buffer | string) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer | string) => output.push(chunk.toString()));
  const exit = observeExit(child, output);
  const pid = await observeSpawn(child, exit);
  let stopPromise: Promise<OwnedDaemonExit> | undefined;
  return {
    pid,
    exit,
    terminate: () => (stopPromise ??= terminateUtilityProcess(child, exit)),
  };
}

function observeExit(child: UtilityProcess, output: string[]): Promise<OwnedDaemonExit> {
  return new Promise((resolve) => {
    child.once("exit", (code) => resolve({ code, output: output.join("") }));
  });
}

function observeSpawn(child: UtilityProcess, exit: Promise<OwnedDaemonExit>): Promise<number> {
  return Promise.race([
    new Promise<number>((resolve, reject) => {
      child.once("spawn", () => {
        const pid = child.pid;
        if (pid === undefined) {
          reject(new Error("Desktop daemon spawned without a process identifier"));
          return;
        }
        resolve(pid);
      });
    }),
    exit.then((result) => {
      throw new Error(`Desktop daemon exited during spawn (code ${result.code}): ${result.output.trim()}`);
    }),
  ]);
}

async function terminateUtilityProcess(
  child: UtilityProcess,
  exit: Promise<OwnedDaemonExit>,
): Promise<OwnedDaemonExit> {
  if (child.pid !== undefined) {
    child.kill();
  }
  return withTimeout(exit, STOP_TIMEOUT_MS, "Desktop-owned daemon did not exit within 10 seconds");
}

function withTimeout<Result>(promise: Promise<Result>, timeoutMs: number, message: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    void promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
