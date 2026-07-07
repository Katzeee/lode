import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { SyncProfile } from "./sync/sync-manager.js";
import { SyncProfileEntrySchema, SyncProfileSchema } from "@lode/protocol/proto";

/**
 * SyncProfile (per-doc versions) ↔ wire bytes. The profile is `{subDocId, version: SyncBytes}`; the
 * `version` is ALREADY opaque bytes (the `SyncableDoc` contract closes the CRDT backend), so this
 * codec is a plain passthrough — no CRDT encode/decode here (contrast the prior `VersionVector`
 * round-trip that leaked loro into the wire codec).
 *
 * The sync-protocol envelope (`SyncMessage`) itself is used directly from `@lode/protocol/proto` —
 * see `broker-sync-transport.ts` for `create(SyncMessageSchema, ...)` / `toBinary` / `fromBinary`
 * usage. No TS mirror union here.
 */

/** Encode a SyncProfile (subDocIds + opaque version bytes) as the profileResp body. */
export function encodeProfile(profile: SyncProfile): Uint8Array {
  return toBinary(
    SyncProfileSchema,
    create(SyncProfileSchema, {
      entries: profile.map((e) =>
        create(SyncProfileEntrySchema, { subDocId: e.subDocId, version: e.version }),
      ),
    }),
  );
}

/** Decode a SyncProfile produced by `encodeProfile`. */
export function decodeProfile(bytes: Uint8Array): SyncProfile {
  const msg = fromBinary(SyncProfileSchema, bytes);
  return msg.entries.map((e) => ({ subDocId: e.subDocId, version: e.version }));
}
