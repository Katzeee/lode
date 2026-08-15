import { LoroDoc } from "loro-crdt";

import type { Admission, AuthorityRecord, WorkspaceId } from "../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import { addFactsToSyncProjection, buildFactSyncProjection } from "./fact-sync-projection.js";
import type { AuthorityAdmissionPolicy } from "./fact-authority.js";
import { validateStagedSyncImport } from "./sync-import-validation.js";

export const FACT_SYNC_STATE_DOCUMENT_ID = "fact-sync-state";

export async function loadSyncProjection(
  options: Readonly<{
    workspaceId: WorkspaceId;
    loroPeerId: `${number}`;
    documents: DocumentStore;
    admitRecords: AuthorityAdmissionPolicy;
  }>,
  authorityRecords: readonly unknown[],
  validAuthorityRecords: readonly AuthorityRecord[],
): Promise<LoroDoc> {
  const admit = options.admitRecords;
  const loaded = await options.documents.load(FACT_SYNC_STATE_DOCUMENT_ID);
  let projection: LoroDoc;
  try {
    if (!loaded) {
      throw new Error("Fact sync state is absent");
    }
    projection = new LoroDoc();
    projection.setPeerId(options.loroPeerId);
    if (loaded.snapshot) {
      projection.import(loaded.snapshot);
    }
    for (const update of loaded.updates) {
      projection.import(update);
    }
    addFactsToSyncProjection(
      projection,
      validAuthorityRecords.flatMap((record) => (record.recordKind === "fact" ? [record.fact] : [])),
    );
    const validation = validateStagedSyncImport(options.workspaceId, authorityRecords, projection, admit);
    if (validation.kind === "fault" || validation.records.length > 0) {
      throw new Error("Persisted Fact sync state does not match authority");
    }
  } catch {
    projection = buildFactSyncProjection(options.loroPeerId, validAuthorityRecords);
  }
  await persistSyncProjection(options.documents, projection);
  return projection;
}

export async function persistSyncProjection(documents: DocumentStore, projection: LoroDoc): Promise<void> {
  try {
    await documents.writeSnapshot(FACT_SYNC_STATE_DOCUMENT_ID, projection.export({ mode: "snapshot" }));
  } catch {
    /* Derived sync state is rebuilt from immutable Facts. */
  }
}

export async function healFactSyncProjection(
  documents: DocumentStore,
  projection: LoroDoc,
  admission: Admission,
): Promise<void> {
  if (admission.kind === "fault") {
    return;
  }
  addFactsToSyncProjection(projection, admission.snapshot.facts);
  await persistSyncProjection(documents, projection);
}
