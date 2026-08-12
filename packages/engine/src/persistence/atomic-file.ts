// The single owner of the crash-safe small-file protocol. A crash leaves either the previous complete
// file or the new complete file, never a partial write.

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** mkdir -p. */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Read a small text file, or `undefined` if it is missing / unreadable. */
export async function readTextMaybe(path: string | URL): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Read + JSON.parse a file, or `undefined` if it doesn't exist / is unreadable / fails to parse. */
export async function readJsonMaybe<T>(path: string | URL): Promise<T | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Atomic write: a temp file in the same directory → fsync → rename over the target. A crash leaves
 *  either the previous complete file or the new complete file, never a partial write. On Windows
 *  rename refuses to overwrite, so the fallback unlinks the stale target first, then renames. */
export async function atomicWrite(path: string, data: string): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(tmp, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch {
    await unlink(path).catch(() => {});
    await rename(tmp, path);
  }
}
