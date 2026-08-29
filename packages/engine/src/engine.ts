import type { EngineApplicationContract, EngineCommand, WriteResult } from "@lode/sdk";
import { WorkspaceNotFoundError, type EngineApi } from "@lode/sdk/host";

import { projectGovernance } from "./domain/governance/index.js";
import type { PersistenceBackend } from "./subsystems/persistence/backend.js";
import { InMemoryPersistenceBackend } from "./subsystems/persistence/in-memory-persistence-backend.js";
import type { PeerTransportPort, ReplicaExchangeHandler, ReplicaExchangeWire } from "./subsystems/connection/index.js";
import { createConnectionSubsystemDefinition } from "./subsystems/connection/connection-subsystem.js";
import type { EventCapability } from "./subsystems/event/index.js";
import { createEventSubsystemDefinition } from "./subsystems/event/event-subsystem.js";
import type { IdentityCapability } from "./subsystems/identity/index.js";
import { createIdentitySubsystemDefinition } from "./subsystems/identity/identity-subsystem.js";
import { buildEngineSubsystems } from "./subsystems/index.js";
import { createPersistenceSubsystemDefinition } from "./subsystems/persistence/persistence-subsystem.js";
import type { SynchronizationCapability } from "./subsystems/synchronization/index.js";
import { createSynchronizationSubsystemDefinition } from "./subsystems/synchronization/synchronization-subsystem.js";
import type { WorkspaceCapability } from "./subsystems/workspace/index.js";
import { createWorkspaceGovernanceApi } from "./subsystems/workspace/workspace-governance-api.js";
import { createWorkspaceSubsystemDefinition } from "./subsystems/workspace/workspace-subsystem.js";

export type EngineOptions = Readonly<{
  persistence?: PersistenceBackend;
  peerTransport?: PeerTransportPort;
}>;

export type Engine = Readonly<{
  api: EngineApi;
  start(): Promise<void>;
  stop(): Promise<void>;
}>;

export function createEngine(options: EngineOptions = {}): Engine {
  const persistence = createPersistenceSubsystemDefinition(options.persistence ?? new InMemoryPersistenceBackend());
  const event = createEventSubsystemDefinition();
  const identity = createIdentitySubsystemDefinition(persistence);
  const workspace = createWorkspaceSubsystemDefinition(persistence, event, identity);
  const connection = createConnectionSubsystemDefinition(options.peerTransport ?? new DisconnectedPeerTransport());
  const synchronization = createSynchronizationSubsystemDefinition(connection, identity, workspace);
  const built = buildEngineSubsystems(
    [persistence, event, identity, workspace, connection, synchronization] as const,
    (capabilities) => createEngineApi(capabilities),
  );
  return { api: built.api, start: () => built.lifecycle.start(), stop: () => built.lifecycle.stop() };
}

type ApiCapabilities = Readonly<{
  event: EventCapability;
  identity: IdentityCapability;
  workspace: WorkspaceCapability;
  synchronization: SynchronizationCapability;
}>;

function createEngineApi(capabilities: ApiCapabilities): EngineApi {
  return {
    application: wrappedApplication(
      { ...capabilities.workspace.application, subscribe: capabilities.event.subscribe },
      { identity: capabilities.identity.vault, workspace: capabilities.workspace },
    ),
    identity: identityOperations(capabilities.identity),
    governance: createWorkspaceGovernanceApi(capabilities.identity, capabilities.workspace),
    workspaces: workspaceOperations(capabilities.workspace, capabilities.synchronization),
    replicas: {
      synchronize: (workspaceId, endpoint) => capabilities.synchronization.synchronize(workspaceId, endpoint),
    },
  };
}

function identityOperations(identity: IdentityCapability): EngineApi["identity"] {
  return {
    listActors: () => Promise.resolve({ vaultExists: identity.vault.exists(), actors: identity.vault.listActors() }),
    createActor: async (input) => {
      const created = await identity.vault.createActor({ label: input.label, passphrase: input.passphrase });
      return { actorId: created.actorId, recoveryPhrase: created.phrase };
    },
    importActor: (input) =>
      identity.vault.importActor({ phrase: input.recoveryPhrase, passphrase: input.passphrase, label: input.label }),
    unlockVault: async (passphrase) => ({
      vaultExists: identity.vault.exists(),
      actors: await identity.vault.unlock(passphrase),
    }),
    lockVault: () => identity.vault.lock(),
    peerMaterial: () => {
      return Promise.resolve({
        peerId: identity.peer.peerId(),
        peerIdentityPublicKey: Buffer.from(identity.peer.identityPublicKey()).toString("base64"),
        peerKxPublicKey: Buffer.from(identity.peer.exchangePublicKey()).toString("base64"),
        actorIds: identity.vault.listActors().map((actor) => actor.actorId),
      });
    },
  };
}

function workspaceOperations(
  workspace: WorkspaceCapability,
  synchronization: SynchronizationCapability,
): EngineApi["workspaces"] {
  return {
    listWorkspaces: () => workspace.list(),
    createWorkspace: (input) => workspace.create(input),
    adoptWorkspace: (input) => adoptWorkspace(workspace, synchronization, input),
  };
}

async function adoptWorkspace(
  workspace: WorkspaceCapability,
  synchronization: SynchronizationCapability,
  input: Readonly<{ endpoint: string; workspaceId: string }>,
): Promise<Readonly<{ workspaceId: string; label: string }>> {
  const staging = await workspace.stage(input.workspaceId);
  try {
    const exchanged = await synchronization.exchange(input.workspaceId, staging, input.endpoint);
    if (exchanged.pulled === 0) {
      throw new Error(`Remote ${input.endpoint} served no Fact authority for workspace ${input.workspaceId}`);
    }
    const snapshot = staging.facts.snapshot();
    if (!projectGovernance(snapshot.facts).established) {
      throw new Error("Remote Fact authority is not governed; nothing to adopt");
    }
    return await staging.promote();
  } catch (error) {
    try {
      await staging.discard();
    } catch (discardError) {
      const primary = toError(error);
      throw new AggregateError([primary, toError(discardError)], "Workspace adoption failed to clean up staging", {
        cause: discardError,
      });
    }
    throw error;
  }
}

class DisconnectedPeerTransport implements PeerTransportPort {
  start(_handler: ReplicaExchangeHandler): void {}

  dial(_endpoint: string): ReplicaExchangeWire {
    throw new Error("This Engine Host has no Peer Transport");
  }

  close(): void {}
}

function wrappedApplication(
  inner: EngineApplicationContract,
  context: Readonly<{
    identity: IdentityCapability["vault"];
    workspace: Pick<WorkspaceCapability, "authority">;
  }>,
): EngineApplicationContract {
  return {
    execute: async (command) => actorRejection(command, context) ?? (await inner.execute(command)),
    query: inner.query,
    subscribe: inner.subscribe,
  };
}

function actorRejection(
  command: EngineCommand,
  context: Readonly<{
    identity: IdentityCapability["vault"];
    workspace: Pick<WorkspaceCapability, "authority">;
  }>,
): WriteResult | null {
  const actorId = (command as Readonly<{ actorId?: unknown }>).actorId;
  const workspaceId = (command as Readonly<{ workspaceId?: unknown }>).workspaceId;
  if (typeof actorId !== "string" || typeof workspaceId !== "string") {
    return null;
  }
  let snapshot;
  try {
    snapshot = context.workspace.authority(workspaceId).snapshot();
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return null;
    }
    throw error;
  }
  const state = projectGovernance(snapshot.facts);
  if (!state.established) {
    return null;
  }
  if (!state.members.has(actorId)) {
    return actorWriteRejection("actor-not-member", `Actor ${actorId} is not a member of workspace ${workspaceId}`);
  }
  if (!context.identity.isActorUnlocked(actorId)) {
    return actorWriteRejection(
      "actor-locked",
      `Actor ${actorId} has no unlocked key in this Home; unlock the vault before writing or governing`,
    );
  }
  return null;
}

function actorWriteRejection(code: "actor-not-member" | "actor-locked", message: string): WriteResult {
  return { status: "rejected", error: { code, message, currentGenerationId: null } };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
