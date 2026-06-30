import { describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame } from "./frame.js";

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

  it("rejects bytes that decode to a frame with no kind", () => {
    // An empty buffer deserializes to a default BrokerFrame (oneof `kind` unset).
    expect(() => decodeFrame(new Uint8Array(0))).toThrow();
  });
});
