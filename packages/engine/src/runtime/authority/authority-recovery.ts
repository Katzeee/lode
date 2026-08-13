import {
  parseAuthorityRecords,
  type FactFrontier,
  type FactSnapshot,
  type WorkspaceId,
} from "../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import { AuthorityFaultError } from "./errors.js";
import type { AuthorityAdmissionPolicy } from "./fact-authority.js";
import { writeAuthoritySnapshot } from "./authority-journal.js";
import {
  admitStoredRecords,
  notifyAdmissionAdvance,
  validRecordPrefix,
} from "./authority-records.js";

export async function recoverAuthorityJournal(
  input: Readonly<{
    workspaceId: WorkspaceId;
    documents: DocumentStore;
    documentId: string;
    records: readonly unknown[];
    admitRecords: AuthorityAdmissionPolicy;
    onAuthorityAdvanced?: (frontier: FactFrontier) => void;
  }>,
): Promise<Readonly<{ records: readonly unknown[]; snapshot: FactSnapshot }>> {
  const before = admitStoredRecords(input.workspaceId, input.records, input.admitRecords);
  const records = parseAuthorityRecords(
    validRecordPrefix(input.workspaceId, input.records, input.admitRecords),
  );
  await writeAuthoritySnapshot(input.documents, input.documentId, records);
  const after = admitStoredRecords(input.workspaceId, records, input.admitRecords);
  if (after.kind === "fault") {
    throw new AuthorityFaultError(
      after.fault ?? "Authority recovery did not produce a valid prefix",
    );
  }
  notifyAdmissionAdvance(before, after, input.onAuthorityAdvanced);
  return { records, snapshot: after.snapshot };
}
