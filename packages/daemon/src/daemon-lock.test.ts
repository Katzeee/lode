import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireDaemonLock } from "./daemon-lock.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Lode Home daemon ownership", () => {
  it("admits one daemon and releases the Home for its successor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lode-daemon-lock-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "daemon.lock");
    const first = await acquireDaemonLock(path);
    await expect(acquireDaemonLock(path)).rejects.toThrow("already owns this Lode Home");
    await first.release();
    const successor = await acquireDaemonLock(path);
    await successor.release();
  });

  it("reclaims a lock whose owner no longer exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lode-daemon-stale-lock-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "daemon.lock");
    const exited = spawn(process.execPath, ["-e", ""]);
    const stalePid = exited.pid;
    await once(exited, "exit");
    if (stalePid === undefined) {
      throw new Error("Test process has no pid");
    }
    await mkdir(path);
    await writeFile(join(path, "owner"), `${stalePid}:00000000-0000-4000-8000-000000000000\n`);
    const lock = await acquireDaemonLock(path);
    await lock.release();
  });

  it("surfaces a corrupt or incomplete lock instead of deleting it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lode-daemon-corrupt-lock-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "daemon.lock");
    await mkdir(path);
    await writeFile(join(path, "owner"), "not-a-process\n");

    await expect(acquireDaemonLock(path)).rejects.toThrow("corrupt ownership marker");
    await expect(readFile(join(path, "owner"), "utf8")).resolves.toBe("not-a-process\n");
  });

  it("reports loss of its ownership marker on release", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lode-daemon-changed-lock-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "daemon.lock");
    const lock = await acquireDaemonLock(path);
    await writeFile(join(path, "owner"), `${process.pid}:00000000-0000-4000-8000-000000000000\n`);

    await expect(lock.release()).rejects.toThrow("ownership marker changed unexpectedly");
  });
});
