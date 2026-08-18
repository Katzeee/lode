import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startDaemon, type Daemon } from "@lode/daemon";
import { createEngine } from "@lode/engine/host";

import { runLode } from "../../src/composition.js";

/**
 * In-process product harness: a registered Lode Home whose daemon runs in this
 * process and publishes its endpoint/token files, exactly like a spawned one.
 * runLode connects through the real home flow — probe finds the in-process
 * daemon, so no launcher ever fires.
 */

export const accessToken = "home-harness-access-token";

const temporaryDirectories: string[] = [];

export type Run = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  envelope: Record<string, unknown> | undefined;
}>;

export type HomeHarness = Readonly<{
  run(argv: readonly string[]): Promise<Run>;
  stop(): Promise<void>;
}>;

export async function startHomeHarness(label: string, workspaceLabel: string): Promise<HomeHarness> {
  const home = await temporaryDirectory(`lode-${label}-home-`);
  const configDir = await temporaryDirectory(`lode-${label}-config-`);
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "token"), `${accessToken}\n`, "utf8");
  await writeFile(
    join(configDir, "lode.toml"),
    `default_home = "main"\n\n[homes.main]\npath = ${tomlPath(home)}\n`,
    "utf8",
  );
  const engine = await createEngine({ persistence: { dataRoot: join(home, "data") } });
  const daemon: Daemon = await startDaemon({
    engine,
    listen: "tcp://127.0.0.1:0",
    accessToken,
    status: { homeName: "main", daemonVersion: "test", homePath: home },
  });
  await engine.workspaces.createWorkspace("workspace", workspaceLabel);
  await writeFile(join(home, "endpoint"), `${daemon.address}\n`, "utf8");
  let stopped = false;
  return {
    run: async (argv: readonly string[]) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runLode({
        argv: ["--format", "json", "--workspace", "workspace", ...argv],
        environment: { LODE_CONFIG_DIR: configDir },
        platform: process.platform,
        io: {
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
        },
      });
      let envelope: Record<string, unknown> | undefined;
      try {
        envelope = JSON.parse(stdout.join("")) as Record<string, unknown>;
      } catch {
        envelope = undefined;
      }
      return { exitCode, stdout: stdout.join(""), stderr: stderr.join(""), envelope };
    },
    stop: async () => {
      if (!stopped) {
        stopped = true;
        await daemon.stop();
      }
    },
  };
}

export { temporaryDirectories };

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function tomlPath(path: string): string {
  return `"${path.replace(/\\/gu, "\\\\")}"`;
}
