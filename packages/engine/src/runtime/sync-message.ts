import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { VersionVector } from "loro-crdt";
import type { SyncProfile } from "./sync.js";
import { SyncProfileEntrySchema, SyncProfileSchema } from "@lode/protocol/proto";

/**
 * SyncProfile (per-doc version vectors) ↔ wire bytes. Adapts the engine's `SyncProfile` (TS array
 * of `{docId, version: VersionVector}`) to the protobuf `SyncProfile` shape — `VersionVector` is a
 * `loro-crdt` class with its own encode/decode that protobuf can't generate.
 *
 * The sync-protocol envelope (`SyncMessage`) itself is now used directly from `@lode/protocol/proto`
 * — see `broker-sync-transport.ts` for `create(SyncMessageSchema, ...)` / `toBinary` / `fromBinary`
 * usage. No TS mirror union here.
 */

/** Encode a SyncProfile (docIds + version vectors) as the profileResp body. */
export function encodeProfile(profile: SyncProfile): Uint8Array {
  return toBinary(
    SyncProfileSchema,
    create(SyncProfileSchema, {
      entries: profile.map((e) =>
        create(SyncProfileEntrySchema, { docId: e.docId, version: e.version.encode() }),
      ),
    }),
  );
}

/** Decode a SyncProfile produced by `encodeProfile`. */
export function decodeProfile(bytes: Uint8Array): SyncProfile {
  const msg = fromBinary(SyncProfileSchema, bytes);
  return msg.entries.map((e) => ({ docId: e.docId, version: VersionVector.decode(e.version) }));
}
