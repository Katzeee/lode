import { canonicalJson, type AuthorityRecord } from "../../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/index.js";

export const FACT_AUTHORITY_JOURNAL_DOCUMENT_ID = "fact-authority-journal";

export type LoadedAuthorityJournal = Readonly<{
  records: readonly unknown[];
  updateCount: number;
}>;

export async function loadAuthorityJournal(
  documents: DocumentStore,
  documentId: string,
): Promise<LoadedAuthorityJournal> {
  const loaded = await documents.load(documentId);
  const records = [
    ...(loaded?.snapshot ? decodeRecords(loaded.snapshot) : []),
    ...(loaded?.updates.flatMap(decodeRecords) ?? []),
  ];
  return { records, updateCount: loaded?.updates.length ?? 0 };
}

export function appendAuthorityBatch(
  documents: DocumentStore,
  documentId: string,
  records: readonly AuthorityRecord[],
): Promise<number> {
  return documents.appendUpdate(documentId, encodeRecords(records));
}

export function writeAuthoritySnapshot(
  documents: DocumentStore,
  documentId: string,
  records: readonly unknown[],
): Promise<void> {
  return documents.writeSnapshot(documentId, encodeRecords(records));
}

function encodeRecords(records: readonly unknown[]): Uint8Array {
  return new TextEncoder().encode(canonicalJson(records));
}

function decodeRecords(bytes: Uint8Array): unknown[] {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(value) ? value : [{ recordKind: "invalid-authority-batch" }];
  } catch {
    return [{ recordKind: "invalid-authority-json" }];
  }
}
