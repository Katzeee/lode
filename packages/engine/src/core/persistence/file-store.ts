import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class FileStore {
  constructor(private readonly filePath: string) {}

  async save(data: Uint8Array): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, data);
    await rename(tmpPath, this.filePath);
  }

  async load(): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(this.filePath);
      return new Uint8Array(buf);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async exists(): Promise<boolean> {
    try {
      await readFile(this.filePath);
      return true;
    } catch {
      return false;
    }
  }

  getPath(): string {
    return this.filePath;
  }
}
