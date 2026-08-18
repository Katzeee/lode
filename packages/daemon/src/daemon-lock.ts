import { open, readFile, unlink, type FileHandle } from "node:fs/promises";

export type DaemonLock = Readonly<{
  release(): Promise<void>;
}>;

export async function acquireDaemonLock(path: string): Promise<DaemonLock> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(`${process.pid}\n`);
      return { release: () => releaseDaemonLock(handle, path) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const holder = Number.parseInt(await readFile(path, "utf8").catch(() => ""), 10);
      if (Number.isInteger(holder) && holder > 0 && processExists(holder)) {
        throw new Error(`A daemon already owns this Lode Home (pid ${holder})`, { cause: error });
      }
      await unlink(path).catch(() => {});
    }
  }
  throw new Error("Unable to acquire the Lode Home daemon lock");
}

async function releaseDaemonLock(handle: FileHandle, path: string): Promise<void> {
  await handle.close();
  const holder = Number.parseInt(await readFile(path, "utf8").catch(() => ""), 10);
  if (holder === process.pid) {
    await unlink(path).catch(() => {});
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
