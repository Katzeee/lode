import { describe, expect, it } from "vitest";
import { InMemoryDocStore } from "./in-memory-doc-store.js";
import type { LoadedDocBytes } from "./doc-store.js";

const u = (n: number): Uint8Array => Uint8Array.of(n);
const loaded = (snapshot: Uint8Array | null, ...updates: Uint8Array[]): LoadedDocBytes => ({
  snapshot,
  updates,
});

describe("InMemoryDocStore", () => {
  it("load returns null for an unknown id; listIds starts empty", async () => {
    const s = new InMemoryDocStore();
    expect(await s.load("x")).toBeNull();
    expect(await s.listIds()).toEqual([]);
  });

  it("appendUpdate accumulates a per-id tail and returns a monotonic seq", async () => {
    const s = new InMemoryDocStore();
    expect(await s.appendUpdate("a", u(1))).toBe(1);
    expect(await s.appendUpdate("a", u(2))).toBe(2);
    expect(await s.appendUpdate("b", u(9))).toBe(1); // seq is per-id
    expect((await s.load("a"))?.updates).toEqual([u(1), u(2)]);
  });

  it("writeSnapshot drops the updates it covers (compaction); later appends start a fresh tail", async () => {
    const s = new InMemoryDocStore();
    await s.appendUpdate("a", u(1));
    await s.appendUpdate("a", u(2));
    await s.writeSnapshot("a", u(99));
    expect(await s.load("a")).toEqual(loaded(u(99))); // updates compacted away
    await s.appendUpdate("a", u(3));
    expect(await s.load("a")).toEqual(loaded(u(99), u(3)));
  });

  it("a seed pre-populates snapshot + post-snapshot updates per id", async () => {
    const seed = new Map<string, LoadedDocBytes>([
      ["sys:tree", loaded(u(10))],
      ["sys:s1", loaded(u(20), u(21), u(22))],
    ]);
    const s = new InMemoryDocStore(seed);
    expect(await s.load("sys:tree")).toEqual(loaded(u(10)));
    expect(await s.load("sys:s1")).toEqual(loaded(u(20), u(21), u(22)));
    expect(await s.listIds()).toEqual(expect.arrayContaining(["sys:tree", "sys:s1"]));
  });

  it("listIds is the union of snapshotted and updated ids", async () => {
    const s = new InMemoryDocStore();
    await s.writeSnapshot("only-snap", u(1));
    await s.appendUpdate("only-upd", u(2));
    expect(await s.listIds()).toEqual(expect.arrayContaining(["only-snap", "only-upd"]));
  });
});
