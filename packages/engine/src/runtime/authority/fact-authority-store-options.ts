import type { FactFrontier, ReplicaId, WorkspaceId } from "../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import type { AuthorityAdmissionPolicy } from "./fact-authority.js";

export const FACT_AUTHORITY_JOURNAL_DOCUMENT_ID = "fact-authority-journal";

export type FactAuthorityStoreOptions = Readonly<{
  workspaceId: WorkspaceId;
  replicaId: ReplicaId;
  loroPeerId: `${number}`;
  documents: DocumentStore;
  onAuthorityAdvanced?: (frontier: FactFrontier) => void;
  snapshotInterval?: number;
  admitRecords: AuthorityAdmissionPolicy;
}>;
