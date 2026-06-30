import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { decodeProfile, encodeProfile } from "./sync-message.js";

describe("sync-message profile codec", () => {
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
