import type { BlockEngine } from "../engine.js";
import type { EngineEvent, EngineEventType } from "../types.js";

export interface CommandDef {
  execute(ctx: EngineContext, args?: unknown): void;
  can?(ctx: EngineContext, args?: unknown): boolean;
}

export interface InstalledPlugin {
  dispose(): void;
}

export interface Plugin {
  readonly name: string;
  readonly priority?: number;
  defaultStorage?(): Record<string, unknown>;
  install(ctx: EngineContext): InstalledPlugin;
  getPublicApi?(): unknown;
}

export interface EngineContext {
  readonly engine: BlockEngine;
  storage: Record<string, unknown>;
  getPlugin<T = unknown>(name: string): T | undefined;
  on<T extends EngineEventType>(
    event: T,
    handler: (e: Extract<EngineEvent, { type: T }>) => void,
  ): () => void;
}
