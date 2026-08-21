import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { BlobStore } from "./blob-store.js";

export class FileBlobStore implements BlobStore {
  constructor(private readonly file: string) {}

  async read(): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.file));
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw error;
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    const temporary = `${this.file}.tmp`;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, this.file);
    await chmod(this.file, 0o600).catch(() => {});
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}
