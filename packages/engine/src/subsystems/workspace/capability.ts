import type { EngineApplicationContract } from "@lode/sdk";
import type { WorkspaceSummary } from "@lode/sdk/host";

import type { FactAuthorityPort } from "./authority/authority-contract.js";
import type { SyncableComposite } from "./replica-sync.js";

export type WorkspaceReplica = Readonly<{
  facts: FactAuthorityPort;
  sync: SyncableComposite;
}>;

export type StagedWorkspaceReplica = WorkspaceReplica &
  Readonly<{
    workspaceId: string;
    promote(): Promise<Readonly<{ workspaceId: string; label: string }>>;
    discard(): Promise<void>;
  }>;

export type WorkspaceCapability = Readonly<{
  application: Pick<EngineApplicationContract, "execute" | "query">;
  list(): Promise<readonly WorkspaceSummary[]>;
  authority(workspaceId: string): FactAuthorityPort;
  reconcile(workspaceId: string): Promise<void>;
  create(input: Readonly<{ workspaceId: string; label: string; ownerActorId: string }>): Promise<void>;
  stage(workspaceId: string): Promise<StagedWorkspaceReplica>;
  replica(workspaceId: string): WorkspaceReplica;
}>;
