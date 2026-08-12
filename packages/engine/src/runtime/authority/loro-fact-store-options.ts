import type { FactFrontier, ReplicaId, WorkspaceId } from "../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import type { AuthorityAdmissionPolicy } from "./fact-store.js";

export const FACT_AUTHORITY_DOCUMENT_ID = "facts";

export type LoroFactStoreOptions = Readonly<{
  workspaceId: WorkspaceId;
  replicaId: ReplicaId;
  loroPeerId: `${number}`;
  documents: DocumentStore;
  onAuthorityAdvanced?: (frontier: FactFrontier) => void;
  snapshotInterval?: number;
  admitRecords?: AuthorityAdmissionPolicy;
}>;
