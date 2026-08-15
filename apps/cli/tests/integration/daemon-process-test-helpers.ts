import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { runCli } from "../../src/cli.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const tsxCli = resolve(repositoryRoot, "node_modules/tsx/dist/cli.mjs");
const lodeDaemon = resolve(repositoryRoot, "apps/daemon/src/bin/lode-daemon.ts");

export type DaemonProcess = Readonly<{
  address: string;
  stop(): Promise<void>;
}>;

export async function startDaemonProcess(processRoot: string, accessToken: string): Promise<DaemonProcess> {
  const child = spawn(
    process.execPath,
    [
      tsxCli,
      lodeDaemon,
      "--listen",
      "tcp://127.0.0.1:0",
      "--home",
      resolve(processRoot, "home"),
      "--data-root",
      resolve(processRoot, "data"),
      "--log-file",
      resolve(processRoot, "daemon.log"),
      "--access-token",
      accessToken,
    ],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  const address = await listeningAddress(child);
  return { address, stop: () => stopProcess(child) };
}

export async function cliRequest(
  operation: "execute" | "query",
  endpoint: string,
  accessToken: string,
  request: unknown,
): Promise<Record<string, unknown>> {
  let output = "";
  await runCli([operation, endpoint, JSON.stringify(request), "--access-token", accessToken], (text) => {
    output += text;
  });
  return record(JSON.parse(output) as unknown, "CLI response");
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

export function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is not an array`);
  }
  return value;
}

function listeningAddress(child: ChildProcess): Promise<string> {
  return new Promise((resolveAddress, rejectAddress) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      rejectAddress(new Error(`Daemon process did not listen; stderr: ${stderr}`));
    }, 20_000);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const match = /lode daemon listening on: (\S+)/u.exec(stdout);
      if (match?.[1]) {
        clearTimeout(timeout);
        resolveAddress(match[1]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectAddress(new Error(`Daemon process exited before listening (${code}); stderr: ${stderr}`));
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectAddress(error);
    });
  });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  child.kill("SIGTERM");
  const forced = new Promise<void>((resolveForce) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolveForce();
    }, 5_000);
    exited.then(() => clearTimeout(timeout)).catch(() => {});
  });
  await Promise.race([exited, forced]);
}
