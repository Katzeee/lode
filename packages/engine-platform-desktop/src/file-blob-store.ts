import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { BlobStore } from "@lode/engine";

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
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.file), { recursive: true });
    try {
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, this.file);
    } catch (error) {
      try {
        await rm(temporary, { force: true });
      } catch (cleanupError) {
        const failure = new AggregateError([toError(error), toError(cleanupError)], "Blob write and cleanup failed", {
          cause: error,
        });
        throw failure;
      }
      throw error;
    }
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}
