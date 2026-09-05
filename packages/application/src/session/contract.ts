import type { EngineApplicationContract, EngineEvent } from "@lode/sdk";
import type { ActorList, WorkspaceSummary } from "@lode/sdk/host";

export type ApplicationState = Readonly<{
  phase: "initializing" | "locked" | "ready";
  actors: ActorList["actors"];
  workspaces: readonly WorkspaceSummary[];
}>;

export type InitializeInput = Readonly<{ actorLabel: string; passphrase: string }>;
export type InitializeResult = Readonly<{ recoveryPhrase: string; state: ApplicationState }>;
export type ApplicationHost = Readonly<{
  getState(): Promise<ApplicationState>;
  initialize(input: InitializeInput): Promise<InitializeResult>;
  unlock(passphrase: string): Promise<ApplicationState>;
  createWorkspace(label: string): Promise<ApplicationState>;
  onStateChanged(listener: (state: ApplicationState) => void): () => void;
  engine: EngineApplicationContract;
}>;

export type ApplicationEvent =
  | Readonly<{ kind: "state"; state: ApplicationState }>
  | Readonly<{ kind: "engine"; event: EngineEvent }>
  | Readonly<{ kind: "error"; message: string }>;

export type ApplicationConnection = Readonly<{
  request(method: string, input?: unknown): Promise<unknown>;
  subscribe(listener: (event: ApplicationEvent) => void): () => void;
}>;
