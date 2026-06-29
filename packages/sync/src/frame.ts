/**
 * The broker wire frame (design sync-design.md §3). The broker is content-blind: it routes opaque
 * payloads by workspace id, never decoding them. WebSocket already provides message boundaries (no
 * length-prefixing needed, unlike the playground's TCP `wire.ts`). One WS message = one frame.
 *
 * Frame layout: `[tag:1][wsIdLen:2 BE][wsId: utf8][payload: bytes]`. subscribe/unsubscribe carry no
 * payload; publish (client→server) and deliver (server→client) carry the opaque payload.
 */

const TAG_SUBSCRIBE = 0;
const TAG_UNSUBSCRIBE = 1;
const TAG_PUBLISH = 2;
const TAG_DELIVER = 3;
const WSID_MAX_LEN = 0xffff;

export type BrokerFrame =
  | { readonly kind: "subscribe"; readonly wsId: string }
  | { readonly kind: "unsubscribe"; readonly wsId: string }
  | { readonly kind: "publish"; readonly wsId: string; readonly payload: Uint8Array }
  | { readonly kind: "deliver"; readonly wsId: string; readonly payload: Uint8Array };

/** Serialize a frame to bytes for one WebSocket message. */
export function encodeFrame(frame: BrokerFrame): Uint8Array {
  const tag =
    frame.kind === "subscribe"
      ? TAG_SUBSCRIBE
      : frame.kind === "unsubscribe"
        ? TAG_UNSUBSCRIBE
        : frame.kind === "publish"
          ? TAG_PUBLISH
          : TAG_DELIVER;
  const wsIdBytes = Buffer.from(frame.wsId, "utf8");
  if (wsIdBytes.length > WSID_MAX_LEN) {
    throw new Error(`wsId too long (${wsIdBytes.length} > ${WSID_MAX_LEN})`);
  }
  const payload = "payload" in frame ? Buffer.from(frame.payload) : Buffer.alloc(0);
  const out = Buffer.allocUnsafe(1 + 2 + wsIdBytes.length + payload.length);
  out.writeUInt8(tag, 0);
  out.writeUInt16BE(wsIdBytes.length, 1);
  out.set(wsIdBytes, 3);
  out.set(payload, 3 + wsIdBytes.length);
  return out;
}

/** Parse one frame from a WebSocket message's bytes. Throws on a truncated/unknown frame. */
export function decodeFrame(bytes: Uint8Array): BrokerFrame {
  const buf = Buffer.from(bytes);
  if (buf.length < 3) {
    throw new Error("frame too short");
  }
  const tag = buf.readUInt8(0);
  const wsIdLen = buf.readUInt16BE(1);
  if (buf.length < 3 + wsIdLen) {
    throw new Error("frame truncated (wsId)");
  }
  const wsId = buf.subarray(3, 3 + wsIdLen).toString("utf8");
  // Copy the payload into a fresh Uint8Array so it's detached from the decode buffer.
  const payload = new Uint8Array(buf.subarray(3 + wsIdLen));
  switch (tag) {
    case TAG_SUBSCRIBE:
      return { kind: "subscribe", wsId };
    case TAG_UNSUBSCRIBE:
      return { kind: "unsubscribe", wsId };
    case TAG_PUBLISH:
      return { kind: "publish", wsId, payload };
    case TAG_DELIVER:
      return { kind: "deliver", wsId, payload };
    default:
      throw new Error(`unknown frame tag ${tag}`);
  }
}
