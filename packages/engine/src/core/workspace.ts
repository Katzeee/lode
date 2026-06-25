import { Subject } from "rxjs";
import { Engine, type EngineOptions } from "./engine.js";

export type WorkspaceOptions = {
  id?: string;
  idGenerator?: () => string;
};

export type DocOptions = Omit<EngineOptions, "id">;

export class Workspace {
  readonly id: string;
  private readonly _idGenerator: () => string;
  private readonly _docs = new Map<string, Engine>();

  readonly slots = {
    docListUpdated: new Subject<void>(),
  };

  constructor(options: WorkspaceOptions = {}) {
    this.id = options.id ?? crypto.randomUUID();
    this._idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
  }

  get docs(): ReadonlyMap<string, Engine> {
    return this._docs;
  }

  createDoc(docId?: string, options?: DocOptions): Engine {
    const id = docId ?? this._idGenerator();
    if (this._docs.has(id)) {
      throw new Error(`Doc already exists: ${id}`);
    }
    const engine = new Engine({ ...options, id });
    this._docs.set(id, engine);
    this.slots.docListUpdated.next();
    return engine;
  }

  getDoc(id: string): Engine | undefined {
    return this._docs.get(id);
  }

  removeDoc(id: string): void {
    const engine = this._docs.get(id);
    if (!engine) {
      return;
    }
    engine.dispose();
    this._docs.delete(id);
    this.slots.docListUpdated.next();
  }

  dispose(): void {
    for (const engine of this._docs.values()) {
      engine.dispose();
    }
    this._docs.clear();
    this.slots.docListUpdated.complete();
  }
}
