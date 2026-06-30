import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import {
  decodeProfile,
  decodeSyncMessage,
  encodeProfile,
  encodeSyncMessage,
} from "./sync-message.js";

describe("sync-message", () => {
  it("round-trips every message kind", () => {
    const cases = [
      { kind: "profileReq", reqId: "r1" },
      { kind: "profileResp", reqId: "r2", body: new Uint8Array([1, 2, 3]) },
      { kind: "updatesReq", reqId: "r3", docId: "main", body: new Uint8Array([9, 9]) },
      { kind: "updatesResp", reqId: "r4", body: new Uint8Array([0, 255, 0]) },
      { kind: "updatesPush", docId: "s3", body: new Uint8Array([7, 7, 7, 0]) },
    ] as const;
    for (const m of cases) {
      expect(decodeSyncMessage(encodeSyncMessage(m))).toEqual(m);
    }
  });

  it("preserves an opaque binary body with embedded zeros", () => {
    const body = new Uint8Array([0, 1, 0, 255, 0, 0, 7]);
    const m = decodeSyncMessage(encodeSyncMessage({ kind: "updatesPush", docId: "x", body }));
    if (m.kind !== "updatesPush") {
      throw new Error("expected updatesPush");
    }
    expect(Buffer.from(m.body).equals(Buffer.from(body))).toBe(true);
  });

  it("round-trips a utf8 docId / reqId", () => {
    const m = decodeSyncMessage(
      encodeSyncMessage({
        kind: "updatesReq",
        reqId: "req-Ω",
        docId: "doc-ü",
        body: new Uint8Array(),
      }),
    );
    if (m.kind !== "updatesReq") {
      throw new Error("expected updatesReq");
    }
    expect(m.reqId).toBe("req-Ω");
    expect(m.docId).toBe("doc-ü");
  });

  it("rejects bytes that decode to a message with no kind", () => {
    // An empty buffer deserializes to a default SyncMessage (oneof `kind` unset).
    expect(() => decodeSyncMessage(new Uint8Array(0))).toThrow();
  });

  it("encodeProfile / decodeProfile round-trip a real version vector", () => {
    const doc = new LoroDoc();
    doc.getText("t").insert(0, "hello");
    doc.commit();
    const version = doc.version();
    const profile = [{ docId: "main", version }];
    const decoded = decodeProfile(encodeProfile(profile));
    expect(decoded).toHaveLength(1);
    const entry = decoded.at(0);
    if (!entry) {
      throw new Error("expected a decoded entry");
    }
    expect(entry.docId).toBe("main");
    expect(entry.version.compare(version)).toBe(0); // VV equal
  });

  it("encodeProfile round-trips a multi-doc profile", () => {
    const a = new LoroDoc();
    a.getText("t").insert(0, "a");
    a.commit();
    const b = new LoroDoc();
    b.getText("t").insert(0, "bb");
    b.commit();
    const profile = [
      { docId: "main", version: a.version() },
      { docId: "s1", version: b.version() },
    ];
    const decoded = decodeProfile(encodeProfile(profile));
    expect(decoded.map((p) => p.docId)).toEqual(["main", "s1"]);
    const s1 = decoded.at(1);
    if (!s1) {
      throw new Error("expected a second decoded entry");
    }
    expect(s1.version.compare(b.version())).toBe(0);
  });
});
