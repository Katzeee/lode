import type {
  EngineLifecycleService,
  EngineService,
  EngineWorkspaceService,
  ReplicaSyncService,
} from "@lode/protocol/proto";
import type { EngineApplicationContract } from "./contract.js";

export type SyncProfileEntry = Readonly<{ documentId: string; version: Uint8Array }>;

export type ReplicaPeer = Readonly<{
  profile(): Promise<readonly SyncProfileEntry[]>;
  fetch(documentId: string, from: Uint8Array): Promise<Uint8Array>;
  send(documentId: string, bytes: Uint8Array): Promise<void>;
}>;

export type WorkspaceRunState = "active" | "authority-fault";

/** Raised when an operation targets a workspace the catalog does not contain. */
export class WorkspaceNotFoundError extends Error {
  constructor(workspaceId: string) {
    super(`Workspace does not exist: ${workspaceId}`);
    this.name = "WorkspaceNotFoundError";
  }
}

export type WorkspaceSummary = Readonly<{
  workspaceId: string;
  label: string;
  state: WorkspaceRunState;
}>;

export type EngineWorkspaces = Readonly<{
  recoverAuthority(workspaceId: string): Promise<boolean>;
  listWorkspaces(): Promise<readonly WorkspaceSummary[]>;
  createWorkspace(workspaceId: string, name: string): Promise<void>;
}>;

export type EngineReplicaExchange = Readonly<{
  synchronize(workspaceId: string, peer: ReplicaPeer): Promise<Readonly<{ pulled: number; pushed: number }>>;
  peer(workspaceId: string): ReplicaPeer;
}>;

export type Engine = Readonly<{
  application: EngineApplicationContract;
  workspaces: EngineWorkspaces;
  replicas: EngineReplicaExchange;
  close(): Promise<void>;
}>;

type ProtocolApplicationMethod = keyof (typeof EngineService)["method"];
type ProtocolWorkspaceMethod = keyof (typeof EngineWorkspaceService)["method"];
type ProtocolReplicaMethod = keyof (typeof ReplicaSyncService)["method"];
type ProtocolLifecycleMethod = keyof (typeof EngineLifecycleService)["method"];
type ApplicationMethodMap = Readonly<{
  execute: "execute";
  query: "query";
  listenEvents: "subscribe";
}>;
type WorkspaceMethodMap = Readonly<{
  recoverWorkspaceAuthority: "recoverAuthority";
  listWorkspaces: "listWorkspaces";
  createWorkspace: "createWorkspace";
}>;
type SameMembers<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
type AssertTrue<Value extends true> = Value;

export type EngineApplicationMethodCoverage = AssertTrue<
  SameMembers<ProtocolApplicationMethod, keyof ApplicationMethodMap> extends true
    ? SameMembers<keyof EngineApplicationContract, ApplicationMethodMap[keyof ApplicationMethodMap]>
    : false
>;
export type EngineWorkspaceMethodCoverage = AssertTrue<
  SameMembers<ProtocolWorkspaceMethod, keyof WorkspaceMethodMap> extends true
    ? SameMembers<keyof EngineWorkspaces, WorkspaceMethodMap[keyof WorkspaceMethodMap]>
    : false
>;
export type ReplicaExchangeMethodCoverage = AssertTrue<SameMembers<ProtocolReplicaMethod, keyof ReplicaPeer>>;
export type EngineLifecycleMethodCoverage = AssertTrue<SameMembers<ProtocolLifecycleMethod, "close">>;
