import { randomBytes } from "node:crypto";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import type { WorkspaceStorage } from "../persistence/index.js";
import type { EventSink } from "../event/index.js";
import { createReplicaId, FactAuthority } from "./authority/fact-authority.js";
import { Workspace } from "./workspace.js";
import { CURRENT_PROJECTION_VERSIONS } from "../../domain/reconcile/index.js";
import { BoundedProjectionStore } from "./projection/index.js";

const LOCAL_REPLICA_DOCUMENT_ID = "local-replica";

type LocalReplica = Readonly<{
  replicaId: string;
  loroPeerId: `${number}`;
  reviewCapabilityKey: string;
}>;

export async function createWorkspaceFromStorage(
  storage: WorkspaceStorage,
  options: Readonly<{
    signFact?: (digest: string, actorId: string) => string;
    eventSink?: EventSink;
  }> = {},
) {
  try {
    const local = await loadOrCreateLocalReplica(storage.metadata);
    const facts = await FactAuthority.open({
      workspaceId: storage.workspaceId,
      replicaId: local.replicaId,
      loroPeerId: local.loroPeerId,
      authorityJournal: storage.authorityJournal,
      factReplication: storage.factReplication,
      admitRecords: admitAuthorityRecords,
      signFact: options.signFact,
    });
    const projectionStore = new BoundedProjectionStore(storage.projection);
    const workspace = await Workspace.open({
      workspaceId: storage.workspaceId,
      facts,
      versions: CURRENT_PROJECTION_VERSIONS,
      reviewCapabilityKey: local.reviewCapabilityKey,
      seedGenesis: false,
      eventSink: options.eventSink,
      storage,
      projection: { store: projectionStore },
    });
    return workspace;
  } catch (error) {
    return failAfterRelease(error, storage.release);
  }
}

async function failAfterRelease(primary: unknown, release: () => Promise<void>): Promise<never> {
  try {
    await release();
  } catch (releaseError) {
    throw new AggregateError([toError(primary), toError(releaseError)], "Workspace failed to open cleanly", {
      cause: releaseError,
    });
  }
  throw primary;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function loadOrCreateLocalReplica(documents: WorkspaceStorage["metadata"]): Promise<LocalReplica> {
  const loaded = await documents.load(LOCAL_REPLICA_DOCUMENT_ID);
  if (loaded?.snapshot) {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(loaded.snapshot));
    if (isLocalReplica(parsed)) {
      return parsed;
    }
    throw new Error("Local Replica identity is corrupt");
  }
  const local = {
    replicaId: createReplicaId(),
    loroPeerId: createLoroPeerId(),
    reviewCapabilityKey: randomBytes(32).toString("hex"),
  } as const;
  await documents.writeSnapshot(LOCAL_REPLICA_DOCUMENT_ID, new TextEncoder().encode(JSON.stringify(local)));
  return local;
}

function createLoroPeerId(): `${number}` {
  const value = randomBytes(6).readUIntBE(0, 6) || 1;
  return `${value}`;
}

function isLocalReplica(value: unknown): value is LocalReplica {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.replicaId === "string" &&
    /^[a-z2-7]{26}$/.test(candidate.replicaId) &&
    typeof candidate.loroPeerId === "string" &&
    /^\d+$/.test(candidate.loroPeerId) &&
    typeof candidate.reviewCapabilityKey === "string" &&
    /^[a-f\d]{64}$/.test(candidate.reviewCapabilityKey)
  );
}
