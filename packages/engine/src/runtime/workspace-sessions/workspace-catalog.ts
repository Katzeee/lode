import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type WorkspaceCatalogEntry = Readonly<{ workspaceId: string; label: string }>;

/**
 * Durable record of the workspaces this Engine host serves, with their displayed
 * labels. Workspace sqlite files are named by a one-way digest and the label
 * lives inside the workspace projection, so the catalog is the only index that
 * can answer "what exists" without loading a workspace.
 */
export class WorkspaceCatalog {
  private entries: readonly WorkspaceCatalogEntry[] = [];
  private loaded = false;

  constructor(private readonly file?: string) {}

  async list(): Promise<readonly WorkspaceCatalogEntry[]> {
    await this.load();
    return [...this.entries];
  }

  async has(workspaceId: string): Promise<boolean> {
    await this.load();
    return this.entries.some((entry) => entry.workspaceId === workspaceId);
  }

  async record(workspaceId: string, label: string): Promise<void> {
    await this.load();
    if (this.entries.some((entry) => entry.workspaceId === workspaceId)) {
      return;
    }
    this.entries = [...this.entries, { workspaceId, label }];
    await this.persist();
  }

  private async load(): Promise<void> {
    if (this.loaded || this.file === undefined) {
      this.loaded = true;
      return;
    }
    this.loaded = true;
    try {
      const content: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (Array.isArray(content)) {
        this.entries = content.filter(isCatalogEntry);
      }
    } catch {
      // A missing or unreadable catalog starts empty; creation re-records.
    }
  }

  private async persist(): Promise<void> {
    if (this.file === undefined) {
      return;
    }
    const temporary = `${this.file}.tmp`;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(this.entries, null, 2)}\n`, "utf8");
    await rename(temporary, this.file);
  }
}

function isCatalogEntry(value: unknown): value is WorkspaceCatalogEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.workspaceId === "string" && typeof candidate.label === "string";
}

export function workspaceCatalogFile(dataRoot: string): string {
  return join(dataRoot, "workspace-catalog.json");
}
