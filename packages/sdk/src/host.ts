import type {
  AdoptWorkspaceRequest,
  CreateWorkspaceRequest,
  EngineLifecycleService,
  EngineService,
  EngineWorkspaceService,
  IdentityService,
  WorkspaceGovernanceService,
} from "@lode/protocol/proto";
import type { EngineApplicationContract } from "./contract.js";

/** Raised when an operation targets a Workspace that is not resident in the Engine. */
export class WorkspaceNotFoundError extends Error {
  constructor(workspaceId: string) {
    super(`Workspace does not exist: ${workspaceId}`);
    this.name = "WorkspaceNotFoundError";
  }
}

export class GovernanceAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceAuthorizationError";
  }
}

export class GovernancePreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernancePreconditionError";
  }
}

export type WorkspaceSummary = Readonly<{
  workspaceId: string;
  label: string;
}>;

export type ActorSummary = Readonly<{
  actorId: string;
  label: string;
  createdAt: string;
  unlocked: boolean;
}>;

export type ActorList = Readonly<{
  vaultExists: boolean;
  actors: readonly ActorSummary[];
}>;

export type HomePeerMaterial = Readonly<{
  peerId: string;
  peerIdentityPublicKey: string;
  peerKxPublicKey: string;
  actorIds: readonly string[];
}>;

export type EngineIdentity = Readonly<{
  listActors(): Promise<ActorList>;
  createActor(
    input: Readonly<{ label: string; passphrase: string }>,
  ): Promise<Readonly<{ actorId: string; recoveryPhrase: string }>>;
  importActor(
    input: Readonly<{ recoveryPhrase: string; passphrase: string; label: string }>,
  ): Promise<Readonly<{ actorId: string }>>;
  unlockVault(passphrase: string): Promise<ActorList>;
  lockVault(): Promise<void>;
  peerMaterial(): Promise<HomePeerMaterial>;
}>;

export type GovernancePeerView = Readonly<{
  peerId: string;
  peerKxPublicKey: string;
  admittedAtEpoch: number;
  admittedByActorId: string;
  syncAdmitted: boolean;
}>;

export type GovernanceSummary = Readonly<{
  established: boolean;
  ownerActorId: string | null;
  memberActorIds: readonly string[];
  epoch: number;
  peers: readonly GovernancePeerView[];
}>;

export type EngineGovernance = Readonly<{
  summary(workspaceId: string): Promise<GovernanceSummary>;
  admitActor(
    input: Readonly<{ workspaceId: string; actingActorId: string; actorId: string; requestId?: string }>,
  ): Promise<void>;
  removeActor(
    input: Readonly<{ workspaceId: string; actingActorId: string; actorId: string; requestId?: string }>,
  ): Promise<void>;
  transferOwner(
    input: Readonly<{ workspaceId: string; actingActorId: string; nextOwnerActorId: string; requestId?: string }>,
  ): Promise<void>;
  admitPeer(
    input: Readonly<{
      workspaceId: string;
      actingActorId: string;
      peerId: string;
      peerKxPublicKey: string;
      requestId?: string;
    }>,
  ): Promise<void>;
  revokePeer(
    input: Readonly<{ workspaceId: string; actingActorId: string; peerId: string; requestId?: string }>,
  ): Promise<void>;
  rotateTransit(input: Readonly<{ workspaceId: string; actingActorId: string; requestId?: string }>): Promise<void>;
}>;

export type EngineWorkspaces = Readonly<{
  listWorkspaces(): Promise<readonly WorkspaceSummary[]>;
  createWorkspace(input: Readonly<{ workspaceId: string; label: string; ownerActorId: string }>): Promise<void>;
  adoptWorkspace(
    input: Readonly<{ endpoint: string; workspaceId: string }>,
  ): Promise<Readonly<{ workspaceId: string; label: string }>>;
}>;

export type ReplicaSynchronizationResult = Readonly<{ pulled: number; pushed: number }>;

export type EngineReplicas = Readonly<{
  synchronize(workspaceId: string, endpoint: string): Promise<ReplicaSynchronizationResult>;
}>;

export type EngineApi = Readonly<{
  application: EngineApplicationContract;
  identity: EngineIdentity;
  governance: EngineGovernance;
  workspaces: EngineWorkspaces;
  replicas: EngineReplicas;
}>;

type ProtocolApplicationMethod = keyof (typeof EngineService)["method"];
type ProtocolWorkspaceMethod = keyof (typeof EngineWorkspaceService)["method"];
type ProtocolLifecycleMethod = keyof (typeof EngineLifecycleService)["method"];
type ProtocolIdentityMethod = keyof (typeof IdentityService)["method"];
type ProtocolGovernanceMethod = keyof (typeof WorkspaceGovernanceService)["method"];
type ApplicationMethodMap = Readonly<{
  execute: "execute";
  query: "query";
  listenEvents: "subscribe";
}>;
type SameMembers<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
type AssertTrue<Value extends true> = Value;

export type EngineApplicationMethodCoverage = AssertTrue<
  SameMembers<ProtocolApplicationMethod, keyof ApplicationMethodMap> extends true
    ? SameMembers<keyof EngineApplicationContract, ApplicationMethodMap[keyof ApplicationMethodMap]>
    : false
>;
export type EngineWorkspaceMethodCoverage = AssertTrue<
  SameMembers<ProtocolWorkspaceMethod, "listWorkspaces" | "createWorkspace" | "adoptWorkspace">
>;
export type EngineLifecycleMethodCoverage = AssertTrue<SameMembers<ProtocolLifecycleMethod, "close">>;
export type EngineIdentityMethodCoverage = AssertTrue<
  SameMembers<ProtocolIdentityMethod, keyof EngineIdentity> extends true
    ? SameMembers<keyof EngineIdentity, ProtocolIdentityMethod>
    : false
>;
export type EngineGovernanceMethodCoverage = AssertTrue<SameMembers<ProtocolGovernanceMethod, keyof EngineGovernance>>;
type RequireFields<T, K extends keyof T> = K;
export type WorkspaceCreateRequestShape = RequireFields<CreateWorkspaceRequest, "workspaceId" | "name" | "actorId">;
export type WorkspaceAdoptRequestShape = RequireFields<AdoptWorkspaceRequest, "endpoint" | "workspaceId">;
