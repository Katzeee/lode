import { LoroDoc } from "loro-crdt";

import {
  canonicalJson,
  parseAuthorityRecords,
  type FactFrontier,
  type FactSnapshot,
  type WorkspaceId,
} from "../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import { AuthorityFaultError } from "./errors.js";
import type { AuthorityAdmissionPolicy } from "./fact-store.js";
import { buildFactSyncProjection } from "./fact-sync-projection.js";
import {
  admitStoredRecords,
  notifyAdmissionAdvance,
  readAuthorityRecords,
  validRecordPrefix,
} from "./loro-authority-records.js";

export async function recoverAuthorityDocument(
  input: Readonly<{
    workspaceId: WorkspaceId;
    loroPeerId: `${number}`;
    documents: DocumentStore;
    documentId: string;
    doc: LoroDoc;
    admitRecords: AuthorityAdmissionPolicy;
    onAuthorityAdvanced?: (frontier: FactFrontier) => void;
  }>,
): Promise<Readonly<{ doc: LoroDoc; syncProjection: LoroDoc; snapshot: FactSnapshot }>> {
  const before = admitStoredRecords(
    input.workspaceId,
    readAuthorityRecords(input.doc),
    input.admitRecords,
  );
  const prefix = parseAuthorityRecords(
    validRecordPrefix(input.workspaceId, readAuthorityRecords(input.doc), input.admitRecords),
  );
  const recovered = new LoroDoc();
  recovered.setPeerId(input.loroPeerId);
  const list = recovered.getList<string>("authority-records");
  for (const record of prefix) {
    list.push(canonicalJson(record));
  }
  recovered.commit({ message: "authority-explicit-recovery" });
  await input.documents.writeSnapshot(input.documentId, recovered.export({ mode: "snapshot" }));
  const after = admitStoredRecords(
    input.workspaceId,
    readAuthorityRecords(recovered),
    input.admitRecords,
  );
  if (after.kind === "fault") {
    throw new AuthorityFaultError(
      after.fault ?? "Authority recovery did not produce a valid prefix",
    );
  }
  notifyAdmissionAdvance(before, after, input.onAuthorityAdvanced);
  return {
    doc: recovered,
    syncProjection: buildFactSyncProjection(
      input.workspaceId,
      input.loroPeerId,
      recovered,
      input.admitRecords,
    ),
    snapshot: after.snapshot,
  };
}
