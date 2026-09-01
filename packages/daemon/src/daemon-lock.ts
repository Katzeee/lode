import { randomUUID } from "node:crypto";
import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

type DaemonLock = Readonly<{
  release(): Promise<void>;
}>;

type LockOwner = Readonly<{
  pid: number;
  token: string;
}>;

const OWNER_FILE = "owner";
const OWNER_PATTERN = /^([1-9]\d*):([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\n$/u;

export async function acquireDaemonLock(path: string): Promise<DaemonLock> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(path);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) {
        throw error;
      }
      const existing = await readExistingOwner(path);
      if (processExists(existing.pid)) {
        throw new Error(`A daemon already owns this Lode Home (pid ${existing.pid})`, { cause: error });
      }
      await removeStaleLock(path);
      continue;
    }

    const owner = { pid: process.pid, token: randomUUID() };
    try {
      await writeFile(ownerPath(path), encodeOwner(owner), { flag: "wx" });
      return { release: () => releaseDaemonLock(path, owner) };
    } catch (error) {
      const cleanupErrors = await cleanupFailedAcquisition(path);
      if (cleanupErrors.length > 0) {
        throw new AggregateError([toError(error), ...cleanupErrors], "Daemon lock publication failed to clean up", {
          cause: error,
        });
      }
      throw error;
    }
  }
  throw new Error("Unable to acquire the Lode Home daemon lock");
}

async function readExistingOwner(path: string): Promise<LockOwner> {
  let contents: string;
  try {
    contents = await readFile(ownerPath(path), "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      throw new Error("The Lode Home daemon lock publication is incomplete", { cause: error });
    }
    throw new Error("Cannot inspect the existing Lode Home daemon lock", { cause: error });
  }
  return decodeOwner(contents);
}

async function releaseDaemonLock(path: string, expected: LockOwner): Promise<void> {
  let actual: LockOwner;
  try {
    actual = await readExistingOwner(path);
  } catch (error) {
    throw new Error("The owned Lode Home daemon lock marker is missing or corrupt", { cause: error });
  }
  if (actual.pid !== expected.pid || actual.token !== expected.token) {
    throw new Error("The Lode Home daemon lock ownership marker changed unexpectedly");
  }
  await unlink(ownerPath(path));
  await rmdir(path);
}

async function removeStaleLock(path: string): Promise<void> {
  try {
    await unlink(ownerPath(path));
    await rmdir(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) {
      throw new Error("Cannot remove the stale Lode Home daemon lock", { cause: error });
    }
  }
}

async function cleanupFailedAcquisition(path: string): Promise<readonly Error[]> {
  const failures: Error[] = [];
  try {
    await unlink(ownerPath(path));
  } catch (error) {
    if (!hasCode(error, "ENOENT")) {
      failures.push(toError(error));
    }
  }
  try {
    await rmdir(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) {
      failures.push(toError(error));
    }
  }
  return failures;
}

function ownerPath(path: string): string {
  return join(path, OWNER_FILE);
}

function encodeOwner(owner: LockOwner): string {
  return `${owner.pid}:${owner.token}\n`;
}

function decodeOwner(contents: string): LockOwner {
  const match = OWNER_PATTERN.exec(contents);
  if (!match) {
    throw new Error("The Lode Home daemon lock contains a corrupt ownership marker");
  }
  const pid = Number(match[1]);
  const token = match[2];
  if (!Number.isSafeInteger(pid) || token === undefined) {
    throw new Error("The Lode Home daemon lock contains a corrupt ownership marker");
  }
  return { pid, token };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasCode(error, "ESRCH")) {
      return false;
    }
    if (hasCode(error, "EPERM")) {
      return true;
    }
    throw error;
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === code;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
