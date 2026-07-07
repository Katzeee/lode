import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { decodeProfile, encodeProfile } from "./sync-message.js";

describe("sync-message profile codec", () => {
  it("encodeProfile / decodeProfile round-trip a real doc version (opaque bytes)", () => {
    const doc = new LoroDoc();
    doc.getText("t").insert(0, "hello");
    doc.commit();
    const version = doc.version().encode();
    const profile = [{ subDocId: "sys:tree", version }];
    const decoded = decodeProfile(encodeProfile(profile));
    expect(decoded).toHaveLength(1);
    const entry = decoded.at(0);
    if (!entry) {
      throw new Error("expected a decoded entry");
    }
    expect(entry.subDocId).toBe("sys:tree");
    expect(Buffer.from(entry.version).equals(Buffer.from(version))).toBe(true);
  });

  it("encodeProfile round-trips a multi-doc profile", () => {
    const a = new LoroDoc();
    a.getText("t").insert(0, "a");
    a.commit();
    const b = new LoroDoc();
    b.getText("t").insert(0, "bb");
    b.commit();
    const versionA = a.version().encode();
    const versionB = b.version().encode();
    const profile = [
      { subDocId: "sys:tree", version: versionA },
      { subDocId: "sys:s1", version: versionB },
    ];
    const decoded = decodeProfile(encodeProfile(profile));
    expect(decoded.map((p) => p.subDocId)).toEqual(["sys:tree", "sys:s1"]);
    const s1 = decoded.at(1);
    if (!s1) {
      throw new Error("expected a second decoded entry");
    }
    expect(Buffer.from(s1.version).equals(Buffer.from(versionB))).toBe(true);
  });
});
