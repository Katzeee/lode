import { Engine, type EngineOptions } from "./engine.js";

export type WorkspaceOptions = {
  id?: string;
};

/**
 * A workspace holds exactly one outliner engine — its content. Formerly modeled as a `Map` of docs
 * (a speculative N-doc generality hardwired to 1); collapsed to the single outliner the product
 * actually has. Membership is workspace-level metadata, not a doc here.
 */
export class Workspace {
  readonly id: string;
  private _engine: Engine | null = null;

  constructor(options: WorkspaceOptions = {}) {
    this.id = options.id ?? crypto.randomUUID();
  }

  /** The single outliner engine, or null before `createEngine`. */
  get engine(): Engine | null {
    return this._engine;
  }

  /** Create the workspace's single outliner engine. Throws if already created. */
  createEngine(options?: Omit<EngineOptions, "id">): Engine {
    if (this._engine !== null) {
      throw new Error("Workspace already has an engine");
    }
    this._engine = new Engine(options ?? {});
    return this._engine;
  }

  dispose(): void {
    this._engine?.dispose();
    this._engine = null;
  }
}
