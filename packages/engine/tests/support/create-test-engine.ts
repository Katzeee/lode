import { createEngine, type Engine, type EngineOptions } from "../../src/engine.js";
import type {
  PeerTransportPort,
  ReplicaExchangeHandler,
  ReplicaExchangeWire,
} from "../../src/subsystems/connection/index.js";
import { InMemoryPersistenceBackend } from "./persistence/in-memory-persistence-backend.js";

export type TestEngineOptions = Partial<EngineOptions>;

export function createTestEngine(options: TestEngineOptions = {}): Engine {
  return createEngine({
    persistence: options.persistence ?? new InMemoryPersistenceBackend(),
    peerTransport: options.peerTransport ?? new DisconnectedPeerTransport(),
  });
}

export async function createWorkspaceAs(
  engine: Engine,
  workspaceId: string,
  label: string,
  passphrase: string,
): Promise<Readonly<{ actorId: string; recoveryPhrase: string }>> {
  const created = await engine.api.identity.createActor({ label: `${label} Owner`, passphrase });
  await engine.api.workspaces.createWorkspace({ workspaceId, label, ownerActorId: created.actorId });
  return { actorId: created.actorId, recoveryPhrase: created.recoveryPhrase };
}

class DisconnectedPeerTransport implements PeerTransportPort {
  start(_handler: ReplicaExchangeHandler): void {}

  dial(_endpoint: string): ReplicaExchangeWire {
    throw new Error("This test Engine Host has no Peer Transport");
  }

  close(): void {}
}
