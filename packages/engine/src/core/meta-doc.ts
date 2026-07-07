import { LoroDoc, encodeFrontiers, type LoroList, VersionVector } from "loro-crdt";
import type { SyncBytes, SyncableDoc } from "./syncable.js";

/**
 * A `SyncableDoc` that also offers an append-only record log + a frontier-based dirty check —
 * "a CRDT doc with a log," backend-agnostic. `MembershipLog` depends on THIS abstraction (not the
 * Loro impl), so `membership-log.ts` names no backend; the Loro impl is constructed by the
 * composition root and injected. Records are opaque byte blobs the caller owns the encode/decode of.
 */
export type MetaDoc = SyncableDoc & {
  /** Append one record's bytes to the log. */
  appendRecord(bytes: Uint8Array): void;
  /** The current log records, in order. */
  records(): Uint8Array[];
  /** Commit pending local ops. */
  commit(): void;
  /** Opaque frontier bytes; changed iff the doc advanced since the last call (dirty-check baseline). */
  frontiers(): SyncBytes;
};

/**
 * The loro-crdt backing for `MetaDoc` — the only place loro-crdt appears for meta docs. Constructed
 * by the composition root (`workspace-registry`) and injected into `MembershipLog`; nothing above
 * core imports it. Records are kept as base64 strings in a `LoroList` (a JSON-valued loro container),
 * so the doc itself is a CRDT that syncs like any other `SyncableDoc`.
 */
export class LoroMetaDoc implements MetaDoc {
  readonly id: string;
  private readonly doc: LoroDoc;
  private readonly list: LoroList;

  constructor(id: string, doc: LoroDoc = new LoroDoc()) {
    this.id = id;
    this.doc = doc;
    this.list = doc.getList("log");
  }

  // ── SyncableDoc (opaque bytes; the VV round-trip is internal to this impl) ───

  version(): SyncBytes {
    return this.doc.version().encode();
  }
  exportUpdate(from?: SyncBytes): SyncBytes {
    return this.doc.export(
      from ? { mode: "update", from: VersionVector.decode(from) } : { mode: "update" },
    );
  }
  exportSnapshot(): SyncBytes {
    return this.doc.export({ mode: "snapshot" });
  }
  importUpdate(bytes: SyncBytes): void {
    this.doc.import(bytes);
  }

  // ── record log ───

  appendRecord(bytes: Uint8Array): void {
    this.list.push(Buffer.from(bytes).toString("base64"));
  }
  records(): Uint8Array[] {
    return this.list.toArray().map((s) => Uint8Array.from(Buffer.from(s as string, "base64")));
  }
  commit(): void {
    this.doc.commit();
  }

  // ── dirty-check baseline ───

  frontiers(): SyncBytes {
    return encodeFrontiers(this.doc.oplogFrontiers());
  }
}
