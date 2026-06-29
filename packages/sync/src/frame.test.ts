import { describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame } from "./frame.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("broker frame", () => {
  it("round-trips subscribe / unsubscribe (no payload)", () => {
    for (const kind of ["subscribe", "unsubscribe"] as const) {
      const f = decodeFrame(encodeFrame({ kind, wsId: "ws-1" }));
      expect(f.kind).toBe(kind);
      if (f.kind === "subscribe" || f.kind === "unsubscribe") {
        expect(f.wsId).toBe("ws-1");
      }
    }
  });

  it("round-trips publish / deliver with an opaque binary payload (incl. embedded zeros)", () => {
    const payload = new Uint8Array([0, 1, 2, 0, 255, 254, 0]);
    for (const kind of ["publish", "deliver"] as const) {
      const f = decodeFrame(encodeFrame({ kind, wsId: "ws-7", payload }));
      expect(f.kind).toBe(kind);
      if (f.kind === "publish" || f.kind === "deliver") {
        expect(f.wsId).toBe("ws-7");
        expect(Buffer.from(f.payload).equals(Buffer.from(payload))).toBe(true);
      }
    }
  });

  it("round-trips a utf8 workspace id", () => {
    const f = decodeFrame(encodeFrame({ kind: "subscribe", wsId: "wörkspåce-Ω" }));
    if (f.kind === "subscribe") {
      expect(f.wsId).toBe("wörkspåce-Ω");
    }
  });

  it("rejects a truncated frame", () => {
    expect(() => decodeFrame(new Uint8Array(2))).toThrow();
    expect(() => decodeFrame(enc("x"))).toThrow();
  });

  it("rejects an unknown tag", () => {
    // tag 9, wsIdLen 0 → unknown tag.
    const bad = Buffer.from([9, 0, 0]);
    expect(() => decodeFrame(bad)).toThrow();
  });

  it("encodes subscribe with no payload bytes (compact)", () => {
    const bytes = encodeFrame({ kind: "subscribe", wsId: "w" });
    // tag(1) + wsIdLen(2) + wsId(1) = 4 bytes, no payload.
    expect(bytes).toHaveLength(4);
  });

  it("rejects a frame whose declared wsId length exceeds the body", () => {
    // tag(publish=2), wsIdLen=0x00ff (255), but body is far shorter.
    const truncated = Buffer.from([2, 0, 255, 65, 66]); // "AB" then nothing
    expect(() => decodeFrame(truncated)).toThrow();
  });

  it("throws when encoding a wsId longer than 0xffff (won't fit the 2-byte length)", () => {
    const long = "x".repeat(0x10000);
    expect(() => encodeFrame({ kind: "subscribe", wsId: long })).toThrow();
    // 0xfffe bytes is fine.
    expect(encodeFrame({ kind: "subscribe", wsId: "x".repeat(0xfffe) })).toHaveLength(
      1 + 2 + 0xfffe,
    );
  });
});
