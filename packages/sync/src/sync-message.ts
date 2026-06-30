import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { VersionVector } from "loro-crdt";
import type { SyncProfile } from "@lode/engine";
import {
  ProfileReqSchema,
  ProfileRespSchema,
  SyncMessageSchema,
  SyncProfileEntrySchema,
  SyncProfileSchema,
  UpdatesPushSchema,
  UpdatesReqSchema,
  UpdatesRespSchema,
  type SyncMessage as SyncMessageProto,
} from "@lode/protocol/proto";

/**
 * The sync protocol carried as the opaque broker payload (design sync-design.md §4). The engine's
 * SyncTransport is request/response; the broker is pub/sub. This envelope adds a correlation id
 * (`reqId`) so an initiator's SyncTransport method can await a peer's response, and a one-way
 * `updatesPush` for `sendUpdates`. Every peer runs both halves: the initiator (driven by SyncManager)
 * and the responder (answering peers from its local store). Wire-encoded as protobuf (sync.proto);
 * the oneof `kind` maps 1:1 to the in-memory union below.
 *
 * For profileResp, `body` is the encoded profile (encodeProfile/decodeProfile). For updatesReq, `body`
 * is a Loro version vector; for updatesResp/updatesPush, Loro update bytes.
 */
export type SyncMessage =
  | { readonly kind: "profileReq"; readonly reqId: string }
  | { readonly kind: "profileResp"; readonly reqId: string; readonly body: Uint8Array }
  | {
      readonly kind: "updatesReq";
      readonly reqId: string;
      readonly docId: string;
      readonly body: Uint8Array;
    }
  | { readonly kind: "updatesResp"; readonly reqId: string; readonly body: Uint8Array }
  | { readonly kind: "updatesPush"; readonly docId: string; readonly body: Uint8Array };

export function encodeSyncMessage(m: SyncMessage): Uint8Array {
  return toBinary(SyncMessageSchema, messageToProto(m));
}

export function decodeSyncMessage(bytes: Uint8Array): SyncMessage {
  return messageFromProto(fromBinary(SyncMessageSchema, bytes));
}

function messageToProto(m: SyncMessage): SyncMessageProto {
  switch (m.kind) {
    case "profileReq":
      return create(SyncMessageSchema, {
        kind: { case: "profileReq", value: create(ProfileReqSchema, { reqId: m.reqId }) },
      });
    case "profileResp":
      return create(SyncMessageSchema, {
        kind: {
          case: "profileResp",
          value: create(ProfileRespSchema, { reqId: m.reqId, body: m.body }),
        },
      });
    case "updatesReq":
      return create(SyncMessageSchema, {
        kind: {
          case: "updatesReq",
          value: create(UpdatesReqSchema, { reqId: m.reqId, docId: m.docId, body: m.body }),
        },
      });
    case "updatesResp":
      return create(SyncMessageSchema, {
        kind: {
          case: "updatesResp",
          value: create(UpdatesRespSchema, { reqId: m.reqId, body: m.body }),
        },
      });
    case "updatesPush":
      return create(SyncMessageSchema, {
        kind: {
          case: "updatesPush",
          value: create(UpdatesPushSchema, { docId: m.docId, body: m.body }),
        },
      });
  }
}

function messageFromProto(msg: SyncMessageProto): SyncMessage {
  const k = msg.kind;
  switch (k.case) {
    case "profileReq":
      return { kind: "profileReq", reqId: k.value.reqId };
    case "profileResp":
      return { kind: "profileResp", reqId: k.value.reqId, body: k.value.body };
    case "updatesReq":
      return { kind: "updatesReq", reqId: k.value.reqId, docId: k.value.docId, body: k.value.body };
    case "updatesResp":
      return { kind: "updatesResp", reqId: k.value.reqId, body: k.value.body };
    case "updatesPush":
      return { kind: "updatesPush", docId: k.value.docId, body: k.value.body };
    case undefined:
      throw new Error("decodeSyncMessage: message has no kind");
  }
}

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
