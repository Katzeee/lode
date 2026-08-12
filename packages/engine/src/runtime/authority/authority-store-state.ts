import { LoroDoc } from "loro-crdt";
import {
  admitAuthorityRecordShapes,
  parseAuthorityRecords,
  type Admission,
  type AuthorityReceipt,
  type AuthorityRecord,
  type InvocationId,
  type ReplicaId,
  type WorkspaceId,
} from "../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import { addFactsToSyncProjection, buildFactSyncProjection } from "./fact-sync-projection.js";
import type { AuthorityAdmissionPolicy } from "./fact-store.js";
import {
  admitStoredRecords,
  localReceiptsByInvocation,
  readAuthorityRecords,
  validRecordPrefix,
} from "./loro-authority-records.js";
import { validateStagedSyncImport } from "./sync-import-validation.js";

export const FACT_SYNC_STATE_DOCUMENT_ID = "fact-sync-state";

export async function loadAuthorityDocument(
  documents: DocumentStore,
  documentId: string,
  loroPeerId: `${number}`,
): Promise<Readonly<{ doc: LoroDoc; updateCount: number }>> {
  const loaded = await documents.load(documentId);
  const doc = new LoroDoc();
  doc.setPeerId(loroPeerId);
  if (loaded?.snapshot) {
    doc.import(loaded.snapshot);
  }
  for (const update of loaded?.updates ?? []) {
    doc.import(update);
  }
  return { doc, updateCount: loaded?.updates.length ?? 0 };
}

export type AuthorityCaches = Readonly<{
  admission: Admission;
  parsedRecords: readonly AuthorityRecord[];
  receipts: ReadonlyMap<InvocationId, AuthorityReceipt>;
}>;

export function deriveAuthorityCaches(
  workspaceId: WorkspaceId,
  replicaId: ReplicaId,
  records: readonly unknown[],
  admit: AuthorityAdmissionPolicy,
  admitted?: Admission,
): AuthorityCaches {
  try {
    const admission = admitted ?? admitStoredRecords(workspaceId, records, admit);
    const receiptRecords =
      admission.kind === "fault" ? validRecordPrefix(workspaceId, records, admit) : records;
    const parsedRecords = parseAuthorityRecords(receiptRecords);
    return {
      admission,
      parsedRecords,
      receipts: new Map(localReceiptsByInvocation(workspaceId, replicaId, parsedRecords)),
    };
  } catch (error) {
    return {
      admission: {
        kind: "fault",
        snapshot: { facts: [], frontier: {} },
        pendingFactIds: [],
        fault: error instanceof Error ? error.message : String(error),
      },
      parsedRecords: [],
      receipts: new Map(),
    };
  }
}

export async function loadSyncProjection(
  options: Readonly<{
    workspaceId: WorkspaceId;
    replicaId: ReplicaId;
    loroPeerId: `${number}`;
    documents: DocumentStore;
    admitRecords?: AuthorityAdmissionPolicy;
  }>,
  authority: LoroDoc,
): Promise<LoroDoc> {
  const admit = options.admitRecords ?? admitAuthorityRecordShapes;
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
    const records = readAuthorityRecords(authority);
    const valid = parseAuthorityRecords(validRecordPrefix(options.workspaceId, records, admit));
    addFactsToSyncProjection(
      projection,
      valid.flatMap((record) => (record.recordKind === "fact" ? [record.fact] : [])),
    );
    const validation = validateStagedSyncImport(options.workspaceId, records, projection, admit);
    if (validation.kind === "fault" || validation.records.length > 0) {
      throw new Error("Persisted Fact sync state does not match authority");
    }
  } catch {
    projection = buildFactSyncProjection(options.workspaceId, options.loroPeerId, authority, admit);
  }
  await persistSyncProjection(options.documents, projection);
  return projection;
}

export async function persistSyncProjection(
  documents: DocumentStore,
  projection: LoroDoc,
): Promise<void> {
  try {
    await documents.writeSnapshot(
      FACT_SYNC_STATE_DOCUMENT_ID,
      projection.export({ mode: "snapshot" }),
    );
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
