import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    await writeFile(path, "not-a-process\n");
    const lock = await acquireDaemonLock(path);
    await lock.release();
  });
});
