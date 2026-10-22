import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const lodeBinary = join(repositoryRoot, "apps/cli/dist/bin/lode.js");
const isWindows = process.platform === "win32";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("home lifecycle through the real CLI binary", () => {
  it("registers a home, reports the daemon cold, auto-starts, and stops cleanly", async () => {
    const { configDir, home } = await setupHome("lifecycle");

    const coldStatus = await run(configDir, ["--format", "json", "daemon", "status"]);
    expect(coldStatus.exitCode).toBe(0);
    expect(envelope(coldStatus).data).toEqual({ running: false });
    expect(
      await run(configDir, ["--format", "json", "daemon", "stop"]).then((result) => envelope(result).data),
    ).toEqual({ stopped: false, running: false });

    const listed = await run(configDir, ["--format", "json", "workspace", "list"]);
    expect(listed.exitCode).toBe(0);
    expect(envelope(listed).data).toEqual({ items: [] });

    const running = await run(configDir, ["--format", "json", "daemon", "status"]);
    const status = envelope(running).data as Record<string, unknown>;
    expect(status.running).toBe(true);
    expect(status.homeName).toBe("main");
    expect(status.homePath).toBe(home);
    const daemonManifest = JSON.parse(await readFile(join(repositoryRoot, "packages/daemon/package.json"), "utf8")) as {
      version: string;
    };
    expect(status.daemonVersion).toBe(daemonManifest.version);
    expect(status.ready).toBe(true);
    expect(status.workspaces).toEqual([]);

    const homeList = await run(configDir, ["--format", "json", "home", "list"]);
    const homes = (envelope(homeList).data as { homes: unknown[] }).homes;
    expect(homes).toEqual([{ name: "main", path: home, default: true, running: true }]);

    const stopped = await run(configDir, ["--format", "json", "daemon", "stop"]);
    expect(envelope(stopped).data).toEqual({ stopped: true });
    expect(existsSync(join(home, "endpoint"))).toBe(false);
    expect(existsSync(join(home, "daemon.lock"))).toBe(false);
    if (!isWindows) {
      expect(existsSync(join(home, "daemon.sock"))).toBe(false);
    }

    expect(
      await run(configDir, ["--format", "json", "daemon", "status"]).then((result) => envelope(result).data),
    ).toEqual({ running: false });
  }, 90_000);

  it("concurrent first starts converge on one daemon", async () => {
    const { configDir } = await setupHome("concurrent");

    const runs = await Promise.all(
      Array.from({ length: 4 }, () => run(configDir, ["--format", "json", "workspace", "list"])),
    );
    for (const attempt of runs) {
      expect(attempt.exitCode, attempt.stdout).toBe(0);
      expect(envelope(attempt).data).toEqual({ items: [] });
    }

    const status = await run(configDir, ["--format", "json", "daemon", "status"]);
    expect((envelope(status).data as Record<string, unknown>).running).toBe(true);
    await run(configDir, ["--format", "json", "daemon", "stop"]);
  }, 90_000);

  it("unregistered homes fail with guidance and never create anything", async () => {
    const configDir = await setupRegistryOnly("unregistered");

    const missing = await run(configDir, ["--format", "json", "--home", "ghost", "workspace", "list"]);
    expect(missing.exitCode).toBe(2);
    const missingEnvelope = JSON.parse(missing.stdout) as Record<string, unknown>;
    expect(missingEnvelope.status).toBe("error");
    const error = missingEnvelope.error as { code: string; message: string };
    expect(error.code).toBe("configuration-missing");
    expect(error.message).toContain('Home "ghost" is not registered');

    const added = await run(configDir, ["--format", "json", "home", "use", "ghost"]);
    expect(added.exitCode).toBe(2);
    const addedEnvelope = JSON.parse(added.stdout) as Record<string, unknown>;
    expect((addedEnvelope.error as { code: string }).code).toBe("target-not-found");
  }, 30_000);

  it("removing the default home clears the default", async () => {
    const { configDir } = await setupHome("remove-default");
    await run(configDir, ["--format", "json", "daemon", "stop"]).catch(() => {});

    const removed = await run(configDir, ["--format", "json", "home", "remove", "main"]);
    expect(removed.exitCode).toBe(0);
    const registry = await readFile(join(configDir, "lode.toml"), "utf8");
    expect(registry).not.toContain("main");
    expect(registry).not.toContain("default_home");
  }, 30_000);
});

type Run = Readonly<{ exitCode: number; stdout: string; stderr: string }>;

function run(configDir: string, argv: readonly string[], timeoutMs = 60_000): Promise<Run> {
  const child = spawn(process.execPath, [lodeBinary, ...argv], {
    cwd: repositoryRoot,
    env: { ...process.env, LODE_CONFIG_DIR: configDir },
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const finished = new Promise<Run>((resolve, rejectRun) => {
    child.once("exit", (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
    child.once("error", rejectRun);
  });
  const timeout = new Promise<never>((_, rejectTimeout) => {
    const timer = setTimeout(() => rejectTimeout(new Error(`CLI timed out: ${argv.join(" ")}`)), timeoutMs);
    finished.then(() => clearTimeout(timer)).catch(() => {});
  });
  return Promise.race([finished, timeout]);
}

function envelope(result: Run): Record<string, unknown> {
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  expect(parsed.status, `${result.stdout}\n${result.stderr}`).toBe("ok");
  return parsed;
}

/** A registered home with token + data; no daemon started — the CLI spawns it. */
async function setupHome(label: string): Promise<Readonly<{ configDir: string; home: string }>> {
  const root = await mkdtemp(join(tmpdir(), `lode-e2e-${label}-`));
  temporaryDirectories.push(root);
  const home = join(root, "home");
  await mkdir(join(home, "data"), { recursive: true });
  await writeFile(join(home, "token"), "e2e-access-token\n", "utf8");
  const configDir = join(root, "config");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "lode.toml"),
    `default_home = "main"\n\n[homes.main]\npath = ${JSON.stringify(home)}\n`,
    "utf8",
  );
  return { configDir, home };
}

/** A config dir with a registered `other` home but nothing else. */
async function setupRegistryOnly(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `lode-e2e-${label}-`));
  temporaryDirectories.push(root);
  const configDir = join(root, "config");
  const otherHome = join(root, "other-home");
  await mkdir(join(otherHome, "data"), { recursive: true });
  await writeFile(join(otherHome, "token"), "e2e-access-token\n", "utf8");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "lode.toml"),
    `default_home = "other"\n\n[homes.other]\npath = ${JSON.stringify(otherHome)}\n`,
    "utf8",
  );
  return configDir;
}
