import type { Admission, AuthorityRecord, FactFrontier, FactSnapshot } from "../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import { AuthorityFaultError } from "./errors.js";
import { writeAuthoritySnapshot } from "./authority-journal.js";
import { notifyAdmissionAdvance } from "./authority-records.js";

export async function recoverAuthorityJournal(
  input: Readonly<{
    documents: DocumentStore;
    documentId: string;
    before: Admission;
    records: readonly AuthorityRecord[];
    recoveryAdmission: Admission;
    onAuthorityAdvanced?: (frontier: FactFrontier) => void;
  }>,
): Promise<Readonly<{ records: readonly AuthorityRecord[]; snapshot: FactSnapshot }>> {
  await writeAuthoritySnapshot(input.documents, input.documentId, input.records);
  const after = input.recoveryAdmission;
  if (after.kind === "fault") {
    throw new AuthorityFaultError(after.fault ?? "Authority recovery did not produce a valid prefix");
  }
  notifyAdmissionAdvance(input.before, after, input.onAuthorityAdvanced);
  return { records: input.records, snapshot: after.snapshot };
}
