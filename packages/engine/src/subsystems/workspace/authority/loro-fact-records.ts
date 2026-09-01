import { LoroDoc, type VersionVector } from "loro-crdt";

import {
  factId,
  normalizeFrontier,
  parseFactBody,
  type Fact,
  type FactBody,
  type FactFrontier,
  type WorkspaceId,
} from "../../../domain/fact/index.js";
import type { SyncBytes } from "./replication.js";

const FACT_LIST_ID = "facts";

export function createFactDocument(peerId: `${number}`): LoroDoc {
  const document = new LoroDoc();
  document.setPeerId(peerId);
  document.setChangeMergeInterval(-1);
  document.getList(FACT_LIST_ID);
  return document;
}

export function assertFactDocumentShape(document: LoroDoc): void {
  const root: unknown = document.toJSON();
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    throw new Error("Fact authority document root is malformed");
  }
  const record = root as Readonly<Record<string, unknown>>;
  if (Object.keys(record).length !== 1 || !Array.isArray(record[FACT_LIST_ID])) {
    throw new Error("Fact authority update changed a non-Fact container");
  }
}

export function appendFactRecords(
  document: LoroDoc,
  workspaceId: WorkspaceId,
  bodies: readonly FactBody[],
  firstSequence: number,
): readonly Fact[] {
  const list = document.getList(FACT_LIST_ID);
  const facts: Fact[] = [];
  let factSequence = firstSequence;
  for (const body of bodies) {
    list.push(body);
    document.commit({ message: `fact/${document.peerIdStr}/${factSequence}` });
    facts.push(readFactAt(document, workspaceId, list.length - 1));
    factSequence += 1;
  }
  return facts;
}

export function readFactState(
  document: LoroDoc,
  workspaceId: WorkspaceId,
): Readonly<{ facts: readonly Fact[]; frontier: FactFrontier }> {
  const list = document.getList(FACT_LIST_ID);
  const facts: Fact[] = [];
  for (let index = 0; index < list.length; index += 1) {
    facts.push(readFactAt(document, workspaceId, index));
  }
  return { facts, frontier: versionFrontier(document.version()) };
}

export function importFactRecords(
  document: LoroDoc,
  workspaceId: WorkspaceId,
  bytes: SyncBytes,
): Readonly<{ facts: readonly Fact[]; status: ReturnType<LoroDoc["import"]> }> {
  const list = document.getList(FACT_LIST_ID);
  const facts: Fact[] = [];
  let importError: Error | undefined;
  const unsubscribe = list.subscribe((batch) => {
    try {
      for (const event of batch.events) {
        if (event.target !== `cid:root-${FACT_LIST_ID}:List` || event.diff.type !== "list") {
          throw new Error("Fact authority import changed a non-Fact container");
        }
        let index = 0;
        for (const delta of event.diff.diff) {
          if (delta.retain !== undefined) {
            index += delta.retain;
          } else if (delta.delete !== undefined) {
            throw new Error("Fact authority updates cannot remove an existing Fact");
          } else {
            for (let offset = 0; offset < delta.insert.length; offset += 1) {
              facts.push(readFactAt(document, workspaceId, index + offset));
            }
            index += delta.insert.length;
          }
        }
      }
    } catch (error) {
      importError = toError(error);
    }
  });
  let status!: ReturnType<LoroDoc["import"]>;
  const failures: Error[] = [];
  try {
    status = document.import(bytes);
  } catch (error) {
    failures.push(toError(error));
  }
  if (importError !== undefined) {
    failures.push(importError);
  }
  try {
    unsubscribe();
  } catch (error) {
    failures.push(toError(error));
  }
  throwImportFailures(failures);
  return { facts, status };
}

export function versionFrontier(version: VersionVector): FactFrontier {
  return normalizeFrontier(Object.fromEntries(version.toJSON()));
}

function readFactAt(document: LoroDoc, workspaceId: WorkspaceId, index: number): Fact {
  const list = document.getList(FACT_LIST_ID);
  return factFromRecord(document, workspaceId, changeAt(document, index), parseFactBody(list.get(index)));
}

function changeAt(document: LoroDoc, index: number): ReturnType<LoroDoc["getChangeAt"]> {
  const list = document.getList(FACT_LIST_ID);
  const cursor = list.getCursor(index, 0);
  let change: ReturnType<LoroDoc["getChangeAt"]>;
  try {
    const operationId = cursor?.pos();
    if (!operationId) {
      throw new Error(`Fact record has no Loro operation identity at index ${index}`);
    }
    change = document.getChangeAt(operationId);
    if (change.length !== 1 || operationId.counter !== change.counter) {
      throw new Error(`One Fact record must occupy one complete Loro Change: ${change.peer}/${change.counter}`);
    }
  } catch (error) {
    try {
      cursor?.free();
    } catch (cleanupError) {
      const failure = new AggregateError([toError(error), toError(cleanupError)], "Fact cursor failed to clean up", {
        cause: error,
      });
      throw failure;
    }
    throw error;
  }
  cursor?.free();
  return change;
}

function factFromRecord(
  document: LoroDoc,
  workspaceId: WorkspaceId,
  change: ReturnType<LoroDoc["getChangeAt"]>,
  body: FactBody,
): Fact {
  const sequence = change.counter + 1;
  const baseObserved = new Map(document.frontiersToVV(change.deps).toJSON());
  return {
    id: factId(workspaceId, change.peer, sequence),
    coordinate: {
      dot: { replicaId: change.peer, sequence },
      observed: normalizeFrontier(Object.fromEntries(baseObserved)),
      lamport: change.lamport + 1,
    },
    body,
  };
}

function throwImportFailures(failures: readonly Error[]): void {
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, "Fact authority import and cleanup failed", { cause: failures[0] });
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
