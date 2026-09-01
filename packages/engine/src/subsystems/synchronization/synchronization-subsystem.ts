import { SyncExchange } from "./sync-exchange.js";
import { defineEngineSubsystem, type EngineSubsystemReference } from "../definition.js";
import type { ReplicaConnectionCapability } from "../connection/index.js";
import type { IdentityCapability } from "../identity/index.js";
import type { WorkspaceCapability, WorkspaceReplica } from "../workspace/index.js";
import type { SynchronizationCapability } from "./capability.js";
import { OutboundExchange, ReplicaExchangeGateway } from "./replica-exchange.js";
import { createReplicaPeer } from "./replica-peer.js";

type SynchronizationIdentity = Pick<IdentityCapability, "peer">;
type SynchronizationWorkspace = Pick<WorkspaceCapability, "replica" | "replicaExchange">;

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
      const gateway = new ReplicaExchangeGateway((workspaceId) => {
        const access = workspaces.replicaExchange(workspaceId);
        return {
          workspaceId,
          facts: access.facts,
          openTransitKey: access.openTransitKey,
          peer: () => createReplicaPeer(access.sync),
        };
      });
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
