import { SyncExchange, type ReplicaPeer, type SyncProfileEntry } from "./sync-exchange.js";
import { defineEngineSubsystem, type EngineSubsystemReference } from "../definition.js";
import type { ReplicaConnectionCapability } from "../connection/index.js";
import type { IdentityCapability } from "../identity/index.js";
import type { WorkspaceCapability, WorkspaceReplica } from "../workspace/index.js";
import type { SynchronizationCapability } from "./capability.js";
import { OutboundExchange, ReplicaExchangeGateway } from "./replica-exchange.js";

type SynchronizationIdentity = Pick<IdentityCapability, "peer">;
type SynchronizationWorkspace = Pick<WorkspaceCapability, "authority" | "replica">;

export function createSynchronizationSubsystemDefinition(
  connection: EngineSubsystemReference<ReplicaConnectionCapability>,
  identity: EngineSubsystemReference<SynchronizationIdentity>,
  workspace: EngineSubsystemReference<SynchronizationWorkspace>,
) {
  return defineEngineSubsystem({
    id: "synchronization",
    dependencies: { connection, identity, workspace },
    create: ({ connection: connections, identity: identities, workspace: workspaces }, control) => {
      let unregister: (() => void) | undefined;
      const gateway = new ReplicaExchangeGateway(identities.peer, (workspaceId) => ({
        workspaceId,
        facts: workspaces.authority(workspaceId),
        peer: () => replicaPeer(workspaces.replica(workspaceId)),
      }));
      const exchange = (workspaceId: string, replica: WorkspaceReplica, endpoint: string) => {
        if (control.stopRequested) {
          throw new Error("Synchronization subsystem is stopping");
        }
        return new SyncExchange(
          replica.sync,
          new OutboundExchange(identities.peer, workspaceId, connections.dial(endpoint)).peer(),
        ).sync();
      };
      return {
        capability: {
          synchronize: async (workspaceId, endpoint) =>
            await exchange(workspaceId, workspaces.replica(workspaceId), endpoint),
          exchange: async (workspaceId, replica, endpoint) => await exchange(workspaceId, replica, endpoint),
        } satisfies SynchronizationCapability,
        init: () => {
          unregister = connections.registerInbound(gateway);
        },
        stop: () => {
          unregister?.();
          unregister = undefined;
        },
      };
    },
  });
}

function replicaPeer(replica: WorkspaceReplica): ReplicaPeer {
  return {
    profile: () =>
      Promise.all(
        replica.sync.docs().map(async (document): Promise<SyncProfileEntry> => ({
          documentId: document.id,
          version: await document.version(),
        })),
      ),
    fetch: async (documentId, from) =>
      (await replica.sync
        .docs()
        .find((candidate) => candidate.id === documentId)
        ?.exportUpdate(from)) ?? new Uint8Array(),
    send: async (documentId, bytes) => {
      try {
        await replica.sync
          .docs()
          .find((candidate) => candidate.id === documentId)
          ?.importUpdate(bytes);
      } finally {
        await replica.sync.heal();
      }
    },
  };
}
