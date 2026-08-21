import { LoroDoc, VersionVector } from "loro-crdt";

import { canonicalJson, parseAuthorityRecords, type AuthorityRecord, type Fact } from "../../../domain/fact/index.js";
import type { SyncBytes, SyncableDoc } from "../replica-sync.js";

export function buildFactSyncProjection(peerId: `${number}`, authorityRecords: readonly AuthorityRecord[]): LoroDoc {
  const projection = new LoroDoc();
  projection.setPeerId(peerId);
  const map = projection.getMap<string>("facts");
  for (const record of authorityRecords) {
    if (record.recordKind === "fact") {
      map.set(syncFactKey(record.fact), canonicalJson(record));
    }
  }
  projection.commit({ message: "fact-sync-projection-rebuild" });
  return projection;
}

export function syncProjectionFacts(projection: LoroDoc): Fact[] {
  const json = projection.toJSON() as unknown;
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error("Fact sync projection is malformed");
  }
  const root = json as Record<string, unknown>;
  if (Object.keys(root).length !== 1 || !("facts" in root)) {
    throw new Error("Fact sync projection contains an unknown root container");
  }
  const values = root.facts;
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw new Error("Fact sync projection has no Fact map");
  }
  const records = Object.entries(values).map(([key, value]) => {
    if (typeof value !== "string") {
      throw new Error("Fact sync projection contains a non-string record");
    }
    return { key, value: JSON.parse(value) as unknown };
  });
  return records.map(({ key, value }) => {
    const [record] = parseAuthorityRecords([value]);
    if (!record || record.recordKind !== "fact") {
      throw new Error("Fact sync projection contains a non-Fact record");
    }
    if (key !== syncFactKey(record.fact)) {
      throw new Error("Fact sync projection entry key does not match its Fact content");
    }
    return record.fact;
  });
}

export function createFactSyncDoc(
  id: string,
  current: () => LoroDoc,
  importUpdate: (bytes: SyncBytes) => Promise<void>,
  heal: () => Promise<void> = () => Promise.resolve(),
): SyncableDoc {
  return {
    id,
    version: async () => {
      await heal();
      return current().version().encode();
    },
    exportUpdate: async (from?: SyncBytes) => {
      await heal();
      return current().export(from ? { mode: "update", from: VersionVector.decode(from) } : { mode: "update" });
    },
    exportSnapshot: async () => {
      await heal();
      return current().export({ mode: "snapshot" });
    },
    importUpdate,
  };
}

export function addFactsToSyncProjection(projection: LoroDoc, facts: readonly Fact[]): void {
  const map = projection.getMap<string>("facts");
  let changed = false;
  for (const fact of facts) {
    const key = syncFactKey(fact);
    const value = canonicalJson({ recordKind: "fact", fact });
    if (map.get(key) !== value) {
      map.set(key, value);
      changed = true;
    }
  }
  if (changed) {
    projection.commit({ message: "fact-sync-projection" });
  }
}

function syncFactKey(fact: Fact): string {
  return `${fact.id}/${fact.contentDigest}`;
}
