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
      if (!hasCode(error, "EEXIST")) {
        throw error;
      }
      let contents: string;
      try {
        contents = await readFile(path, "utf8");
      } catch (readError) {
        if (hasCode(readError, "ENOENT")) {
          continue;
        }
        throw new Error("Cannot inspect the existing Lode Home daemon lock", { cause: readError });
      }
      const holder = Number.parseInt(contents, 10);
      if (Number.isInteger(holder) && holder > 0 && processExists(holder)) {
        throw new Error(`A daemon already owns this Lode Home (pid ${holder})`, { cause: error });
      }
      try {
        await unlink(path);
      } catch (unlinkError) {
        if (!hasCode(unlinkError, "ENOENT")) {
          throw unlinkError;
        }
      }
    }
  }
  throw new Error("Unable to acquire the Lode Home daemon lock");
}

async function releaseDaemonLock(handle: FileHandle, path: string): Promise<void> {
  await handle.close();
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  const holder = Number.parseInt(contents, 10);
  if (holder === process.pid) {
    try {
      await unlink(path);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) {
        throw error;
      }
    }
  }
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
