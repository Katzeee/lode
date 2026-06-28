import type { Socket } from "node:net";
import type { VersionVector } from "loro-crdt";

/**
 * The wire layer for the playground transport: tagged, length-prefixed binary frames over a
 * stream socket.
 *
 * Message kinds:
 *   - `vv` / `update`        (P1): single-doc exchange — a Loro VersionVector (native encode) /
 *                             raw update bytes.
 *   - `profile`              (P2): a peer's set of doc ids (JSON) — lets each side compute the
 *                             union of docs to sync.
 *   - `doc-vv` / `doc-update`(P2): per-doc exchange within a multi-doc round, tagged with `docId`
 *                             so an update for shard `s3` can never be applied to `s7` (routing
 *                             discipline is structural in the protocol).
 *
 * Framing is mandatory: TCP is a byte stream, so without length prefixes a peer could read two
 * messages fused or one message split. This is the kind of boundary bug in-process sync never sees.
 */
export type WireMessage =
  | { readonly kind: "vv"; readonly vv: Uint8Array }
  | { readonly kind: "update"; readonly bytes: Uint8Array }
  | { readonly kind: "profile"; readonly ids: string[] }
  | { readonly kind: "doc-vv"; readonly docId: string; readonly vv: Uint8Array }
  | { readonly kind: "doc-update"; readonly docId: string; readonly bytes: Uint8Array }
  | { readonly kind: "auth"; readonly pubHex: string }
  | { readonly kind: "auth-sig"; readonly sig: Uint8Array };

const TAG_VV = 0;
const TAG_UPDATE = 1;
const TAG_PROFILE = 2;
const TAG_DOC_VV = 3;
const TAG_DOC_UPDATE = 4;
const TAG_AUTH = 5;
const TAG_AUTH_SIG = 6;
const HEADER = 5; // 1 tag byte + 4-byte big-endian length
/** Fail-fast cap on a single frame's declared length — a malformed/huge `len` would otherwise
 *  make `drain()` wait forever for data that never arrives. 64 MiB is far above any real sync
 *  payload and catches garbage immediately (relevant once P3 injects faulty bytes). */
const MAX_FRAME = 64 * 1024 * 1024;

function frame(tag: number, payload: Uint8Array): Buffer {
  const head = Buffer.alloc(HEADER);
  head.writeUInt8(tag, 0);
  head.writeUInt32BE(payload.length, 1);
  return Buffer.concat([head, Buffer.from(payload)]);
}

/** A doc-tagged payload (doc-vv / doc-update): u32 docId-length + docId utf8 + binary. */
function encodeDocPayload(docId: string, bin: Uint8Array): Uint8Array {
  const docIdBytes = Buffer.from(docId, "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32BE(docIdBytes.length, 0);
  return Buffer.concat([head, docIdBytes, Buffer.from(bin)]);
}

function decodeDocPayload(payload: Uint8Array): { docId: string; bin: Uint8Array } {
  const buf = Buffer.from(payload);
  if (buf.length < 4) {
    throw new Error("malformed doc payload: missing length header");
  }
  const docIdLen = buf.readUInt32BE(0);
  if (docIdLen > buf.length - 4) {
    throw new Error(
      `malformed doc payload: docIdLen ${docIdLen} exceeds payload (${buf.length - 4})`,
    );
  }
  const docId = buf.subarray(4, 4 + docIdLen).toString("utf8");
  const bin = new Uint8Array(buf.subarray(4 + docIdLen));
  return { docId, bin };
}

/** A payload-level cipher (encrypt/decrypt the frame PAYLOAD, not the tag/length). P5 plugs in an
 *  AEAD cipher so a forwarding relay sees only ciphertext; P1–P4 pass no cipher (plaintext). */
export type Cipher = {
  enc(plain: Uint8Array): Uint8Array;
  dec(blob: Uint8Array): Uint8Array;
};

/** Per-kind payload extraction (the bytes that get length-prefixed under a tag). Split out so the
 *  FrameSocket can apply an optional cipher to the payload before framing. */
function messagePayload(m: WireMessage): { tag: number; payload: Uint8Array } {
  switch (m.kind) {
    case "vv":
      return { tag: TAG_VV, payload: m.vv };
    case "update":
      return { tag: TAG_UPDATE, payload: m.bytes };
    case "profile":
      return { tag: TAG_PROFILE, payload: Buffer.from(JSON.stringify(m.ids), "utf8") };
    case "doc-vv":
      return { tag: TAG_DOC_VV, payload: encodeDocPayload(m.docId, m.vv) };
    case "doc-update":
      return { tag: TAG_DOC_UPDATE, payload: encodeDocPayload(m.docId, m.bytes) };
    case "auth":
      return { tag: TAG_AUTH, payload: Buffer.from(m.pubHex, "utf8") };
    case "auth-sig":
      return { tag: TAG_AUTH_SIG, payload: m.sig };
  }
}

export function encodeMessage(m: WireMessage): Buffer {
  const { tag, payload } = messagePayload(m);
  return frame(tag, payload);
}

function decodeMessage(tag: number, payload: Uint8Array): WireMessage {
  switch (tag) {
    case TAG_VV:
      return { kind: "vv", vv: payload };
    case TAG_UPDATE:
      return { kind: "update", bytes: payload };
    case TAG_PROFILE:
      return { kind: "profile", ids: JSON.parse(Buffer.from(payload).toString("utf8")) };
    case TAG_DOC_VV: {
      const { docId, bin } = decodeDocPayload(payload);
      return { kind: "doc-vv", docId, vv: bin };
    }
    case TAG_DOC_UPDATE: {
      const { docId, bin } = decodeDocPayload(payload);
      return { kind: "doc-update", docId, bytes: bin };
    }
    case TAG_AUTH:
      return { kind: "auth", pubHex: Buffer.from(payload).toString("utf8") };
    case TAG_AUTH_SIG:
      return { kind: "auth-sig", sig: payload };
    default:
      throw new Error(`unknown wire tag ${tag}`);
  }
}

/**
 * Frames a stream socket into discrete `WireMessage`s. Accumulates incoming chunks and resolves
 * `recv()` awaiters in arrival order. Independent of Loro and of the sync loop — pure transport.
 */
export class FrameSocket {
  private buf = Buffer.alloc(0);
  private readonly waiters: Array<(m: WireMessage) => void> = [];
  constructor(
    private readonly sock: Socket,
    private readonly cipher?: Cipher,
  ) {
    sock.on("data", (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.drain();
    });
  }
  send(m: WireMessage): void {
    const { tag, payload } = messagePayload(m);
    const wire = this.cipher ? this.cipher.enc(payload) : payload;
    this.sock.write(frame(tag, wire));
  }
  recv(): Promise<WireMessage> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.drain();
    });
  }
  private drain(): void {
    while (this.waiters.length > 0 && this.buf.length >= HEADER) {
      const len = this.buf.readUInt32BE(1);
      if (len > MAX_FRAME) {
        throw new Error(`frame too large (${len} > ${MAX_FRAME}); malformed peer input`);
      }
      if (this.buf.length < HEADER + len) {
        return;
      }
      const tag = this.buf.readUInt8(0);
      // Copy into a fresh Uint8Array so the returned payload is immune to later `buf` mutations.
      const rawPayload = new Uint8Array(this.buf.subarray(HEADER, HEADER + len));
      this.buf = this.buf.subarray(HEADER + len);
      const payload = this.cipher ? this.cipher.dec(rawPayload) : rawPayload;
      const resolve = this.waiters.shift();
      if (resolve) {
        resolve(decodeMessage(tag, payload));
      }
    }
  }
}

/** Convenience: are two version vectors pointwise equal? (oracle 6 — transport delivered
 *  everything the VVs promised). Loro `compare` returns 0 on equality. */
export function vvEqual(a: VersionVector, b: VersionVector): boolean {
  return a.compare(b) === 0;
}
