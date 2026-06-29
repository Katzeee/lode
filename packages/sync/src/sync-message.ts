import { VersionVector } from "loro-crdt";
import type { SyncProfile } from "@lode/engine";

/**
 * The sync protocol carried as the opaque broker payload (design: a request/response layer over the
 * broker's pub/sub). The engine's `SyncTransport` is request/response; the broker is pub/sub. This
 * envelope adds a correlation id (`reqId`) so an initiator's `SyncTransport` method can await a peer's
 * response, and a one-way `updates-push` for `sendUpdates`. Every peer runs both halves: the
 * initiator (driven by `SyncManager`) and the responder (answering peers from its local store).
 *
 * Envelope layout (one broker payload): `[msgType:1][reqIdLen:2 BE][reqId utf8][docIdLen:2 BE]
 * [docId utf8][body bytes]`. `reqId` is empty for `updates-push`; `docId` is empty for profile msgs.
 */

const MSG_PROFILE_REQ = 0;
const MSG_PROFILE_RESP = 1;
const MSG_UPDATES_REQ = 2;
const MSG_UPDATES_RESP = 3;
const MSG_UPDATES_PUSH = 4;
const LEN_MAX = 0xffff;

export type SyncMessage =
  | { readonly kind: "profile-req"; readonly reqId: string }
  | { readonly kind: "profile-resp"; readonly reqId: string; readonly body: Uint8Array }
  | {
      readonly kind: "updates-req";
      readonly reqId: string;
      readonly docId: string;
      readonly body: Uint8Array;
    }
  | { readonly kind: "updates-resp"; readonly reqId: string; readonly body: Uint8Array }
  | { readonly kind: "updates-push"; readonly docId: string; readonly body: Uint8Array };

/** For profile-resp, `body` is the encoded profile (see encodeProfile/decodeProfile). For updates-*,
 *  `body` is a Loro version vector (req) or update bytes (resp/push). */
export function encodeSyncMessage(m: SyncMessage): Uint8Array {
  const msgType =
    m.kind === "profile-req"
      ? MSG_PROFILE_REQ
      : m.kind === "profile-resp"
        ? MSG_PROFILE_RESP
        : m.kind === "updates-req"
          ? MSG_UPDATES_REQ
          : m.kind === "updates-resp"
            ? MSG_UPDATES_RESP
            : MSG_UPDATES_PUSH;
  const reqId = "reqId" in m ? m.reqId : "";
  const docId = "docId" in m ? m.docId : "";
  const body = "body" in m ? Buffer.from(m.body) : Buffer.alloc(0);
  const reqIdBytes = Buffer.from(reqId, "utf8");
  const docIdBytes = Buffer.from(docId, "utf8");
  if (reqIdBytes.length > LEN_MAX || docIdBytes.length > LEN_MAX) {
    throw new Error("sync-message: reqId/docId too long");
  }
  const out = Buffer.allocUnsafe(1 + 2 + reqIdBytes.length + 2 + docIdBytes.length + body.length);
  let o = 0;
  out.writeUInt8(msgType, o++);
  out.writeUInt16BE(reqIdBytes.length, o);
  o += 2;
  out.set(reqIdBytes, o);
  o += reqIdBytes.length;
  out.writeUInt16BE(docIdBytes.length, o);
  o += 2;
  out.set(docIdBytes, o);
  o += docIdBytes.length;
  out.set(body, o);
  return out;
}

export function decodeSyncMessage(bytes: Uint8Array): SyncMessage {
  const buf = Buffer.from(bytes);
  if (buf.length < 5) {
    throw new Error("sync-message: too short");
  }
  const msgType = buf.readUInt8(0);
  const reqIdLen = buf.readUInt16BE(1);
  if (buf.length < 3 + reqIdLen + 2) {
    throw new Error("sync-message: truncated (reqId)");
  }
  const reqId = buf.subarray(3, 3 + reqIdLen).toString("utf8");
  const docIdOff = 3 + reqIdLen;
  const docIdLen = buf.readUInt16BE(docIdOff);
  const docIdStart = docIdOff + 2;
  if (buf.length < docIdStart + docIdLen) {
    throw new Error("sync-message: truncated (docId)");
  }
  const docId = buf.subarray(docIdStart, docIdStart + docIdLen).toString("utf8");
  const body = new Uint8Array(buf.subarray(docIdStart + docIdLen));
  switch (msgType) {
    case MSG_PROFILE_REQ:
      return { kind: "profile-req", reqId };
    case MSG_PROFILE_RESP:
      return { kind: "profile-resp", reqId, body };
    case MSG_UPDATES_REQ:
      return { kind: "updates-req", reqId, docId, body };
    case MSG_UPDATES_RESP:
      return { kind: "updates-resp", reqId, body };
    case MSG_UPDATES_PUSH:
      return { kind: "updates-push", docId, body };
    default:
      throw new Error(`sync-message: unknown msgType ${msgType}`);
  }
}

/** Encode a SyncProfile (docIds + version vectors) as self-describing bytes for profile-resp. */
export function encodeProfile(profile: SyncProfile): Uint8Array {
  const parts: Buffer[] = [];
  const count = Buffer.alloc(2);
  count.writeUInt16BE(profile.length);
  parts.push(count);
  for (const entry of profile) {
    const docId = Buffer.from(entry.docId, "utf8");
    const vv = Buffer.from(entry.version.encode());
    if (docId.length > LEN_MAX) {
      throw new Error("encodeProfile: docId too long");
    }
    const docIdHead = Buffer.alloc(2);
    docIdHead.writeUInt16BE(docId.length, 0);
    const vvHead = Buffer.alloc(4);
    vvHead.writeUInt32BE(vv.length, 0);
    parts.push(docIdHead, docId, vvHead, vv);
  }
  return Buffer.concat(parts);
}

/** Decode a SyncProfile produced by `encodeProfile`. */
export function decodeProfile(bytes: Uint8Array): SyncProfile {
  const buf = Buffer.from(bytes);
  if (buf.length < 2) {
    throw new Error("decodeProfile: too short");
  }
  const count = buf.readUInt16BE(0);
  let o = 2;
  const out: SyncProfile = [];
  for (let i = 0; i < count; i++) {
    if (buf.length < o + 2) {
      throw new Error("decodeProfile: truncated (docId len)");
    }
    const docIdLen = buf.readUInt16BE(o);
    o += 2;
    if (buf.length < o + docIdLen + 4) {
      throw new Error("decodeProfile: truncated (vv len)");
    }
    const docId = buf.subarray(o, o + docIdLen).toString("utf8");
    o += docIdLen;
    const vvLen = buf.readUInt32BE(o);
    o += 4;
    if (buf.length < o + vvLen) {
      throw new Error("decodeProfile: truncated (vv)");
    }
    const vv = VersionVector.decode(new Uint8Array(buf.subarray(o, o + vvLen)));
    o += vvLen;
    out.push({ docId, version: vv });
  }
  return out;
}
