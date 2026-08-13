import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { canonicalDigest } from "../../domain/fact/index.js";
import { admitAuthorityRecords } from "../../domain/admission/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import { ensureDir } from "../../persistence/atomic-file.js";
import { InMemoryDocumentStore } from "../../persistence/in-memory-document-store.js";
import { WorkspaceStore } from "../../persistence/workspace-store.js";
import { createReplicaId, FactAuthorityStore } from "../authority/fact-authority-store.js";
import type { FactAuthority } from "../authority/fact-authority.js";
import type { SyncableDoc } from "../../sync/syncable.js";
import { WorkspaceDocStore } from "./doc-store.js";
import { ProjectionCheckpointRepository } from "./projection-checkpoints.js";
import { ProposalWorkspace } from "./proposal-workspace.js";
import { CURRENT_PROJECTION_VERSIONS } from "../../domain/reconcile/index.js";
import { BoundedProjectionMaterializer } from "./bounded-materializer.js";

const LOCAL_REPLICA_DOCUMENT_ID = "local-replica";

type LocalReplica = Readonly<{
  replicaId: string;
  loroPeerId: `${number}`;
  reviewCapabilityKey: string;
}>;

export type OpenedProposalWorkspace = Readonly<{
  workspace: ProposalWorkspace;
  facts: FactAuthority;
  factReplica: SyncableDoc;
  recoverAuthority(): Promise<void>;
  close(): Promise<void>;
}>;

export async function openProposalWorkspace(
  workspaceId: string,
  dataRoot?: string,
): Promise<OpenedProposalWorkspace> {
  const storage = await openDocuments(workspaceId, dataRoot);
  const local = await loadOrCreateLocalReplica(storage.documents);
  const facts = await FactAuthorityStore.open({
    workspaceId,
    replicaId: local.replicaId,
    loroPeerId: local.loroPeerId,
    documents: storage.documents,
    admitRecords: admitAuthorityRecords,
  });
  const materializer = new BoundedProjectionMaterializer(storage.documents);
  const workspace = await ProposalWorkspace.open({
    workspaceId,
    facts,
    versions: CURRENT_PROJECTION_VERSIONS,
    reviewCapabilityKey: local.reviewCapabilityKey,
    checkpoints: new ProjectionCheckpointRepository(storage.documents, local.reviewCapabilityKey),
    generations: materializer,
  });
  return {
    workspace,
    facts,
    factReplica: facts.replication,
    recoverAuthority: () => workspace.recoverAuthority(),
    close: async () => {
      await workspace.close();
      await storage.close();
    },
  };
}

async function openDocuments(
  workspaceId: string,
  dataRoot?: string,
): Promise<Readonly<{ documents: DocumentStore; close(): Promise<void> }>> {
  if (!dataRoot) {
    return { documents: new InMemoryDocumentStore(), close: () => Promise.resolve() };
  }
  const directory = join(dataRoot, "workspaces");
  await ensureDir(directory);
  const store = await WorkspaceStore.open(
    join(directory, `${canonicalDigest(workspaceId)}.sqlite`),
  );
  return { documents: new WorkspaceDocStore(store), close: () => store.close() };
}

async function loadOrCreateLocalReplica(documents: DocumentStore): Promise<LocalReplica> {
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
  await documents.writeSnapshot(
    LOCAL_REPLICA_DOCUMENT_ID,
    new TextEncoder().encode(JSON.stringify(local)),
  );
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
