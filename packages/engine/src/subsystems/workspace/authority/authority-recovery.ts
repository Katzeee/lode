import type { Admission, AuthorityRecord, FactSnapshot } from "../../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/index.js";
import { AuthorityFaultError } from "./errors.js";
import { writeAuthoritySnapshot } from "./authority-journal.js";

export async function recoverAuthorityJournal(
  input: Readonly<{
    documents: DocumentStore;
    documentId: string;
    records: readonly AuthorityRecord[];
    recoveryAdmission: Admission;
  }>,
): Promise<Readonly<{ records: readonly AuthorityRecord[]; snapshot: FactSnapshot }>> {
  await writeAuthoritySnapshot(input.documents, input.documentId, input.records);
  const after = input.recoveryAdmission;
  if (after.kind === "fault") {
    throw new AuthorityFaultError(after.fault ?? "Authority recovery did not produce a valid prefix");
  }
  return { records: input.records, snapshot: after.snapshot };
}
