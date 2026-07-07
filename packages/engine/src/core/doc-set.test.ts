import { describe, expect, it } from "vitest";
import type { SyncableDoc } from "./syncable.js";
import type { Outliner } from "./sharded-store.js";
import { WorkspaceDocSet, SYS_PREFIX } from "./index.js";
import type { MetaDoc } from "./meta-doc.js";

/** A minimal outliner fake — the docSet only reads `docs()`, so we don't need the loro backing. */
function fakeOutliner(docs: SyncableDoc[]): Outliner {
  return {
    docs: () => docs,
    pushDocs: () => docs,
    heal: () => undefined,
    treeSyncDoc: () => docs.at(0)!,
    shardSyncDocs: () => docs.slice(1),
    reconcileDurability: () => undefined,
  };
}

function fakeDoc(id: string): SyncableDoc {
  return {
    id,
    version: () => new Uint8Array(0),
    exportUpdate: () => new Uint8Array(0),
    exportSnapshot: () => new Uint8Array(0),
    importUpdate: () => undefined,
  };
}

function fakeMeta(id: string): MetaDoc {
  return {
    ...fakeDoc(id),
    appendRecord: () => undefined,
    records: () => [],
    commit: () => undefined,
    frontiers: () => new Uint8Array(0),
  };
}

describe("WorkspaceDocSet", () => {
  it("classifies outliner docs as sealed and lists them first", () => {
    const tree = fakeDoc(`${SYS_PREFIX}tree`);
    const shard = fakeDoc(`${SYS_PREFIX}s0`);
    const set = new WorkspaceDocSet(fakeOutliner([tree, shard]));

    expect(set.docs().map((d) => d.id)).toEqual([`${SYS_PREFIX}tree`, `${SYS_PREFIX}s0`]);
    expect(set.entry(`${SYS_PREFIX}tree`)?.securityClass).toBe("sealed");
    expect(set.entry(`${SYS_PREFIX}s0`)?.securityClass).toBe("sealed");
    expect(set.entry("nope")).toBeUndefined();
  });

  it("registers a meta doc with its security class and appends it after the outliner", () => {
    const set = new WorkspaceDocSet(fakeOutliner([fakeDoc(`${SYS_PREFIX}tree`)]));
    const membership = fakeMeta("membership");

    set.registerMeta(membership, "public");

    expect(set.entry("membership")?.doc).toBe(membership);
    expect(set.entry("membership")?.securityClass).toBe("public");
    // Meta docs land after the outliner in docs().
    expect(set.docs().map((d) => d.id)).toEqual([`${SYS_PREFIX}tree`, "membership"]);
  });

  it("rejects a meta id that collides with the reserved sys: namespace", () => {
    const set = new WorkspaceDocSet(fakeOutliner([]));
    expect(() => set.registerMeta(fakeMeta(`${SYS_PREFIX}tree`), "public")).toThrow(/reserved/);
    expect(() => set.registerMeta(fakeMeta(`${SYS_PREFIX}custom`), "public")).toThrow(/reserved/);
  });

  it("rejects a duplicate meta registration", () => {
    const set = new WorkspaceDocSet(fakeOutliner([]));
    set.registerMeta(fakeMeta("membership"), "public");
    expect(() => set.registerMeta(fakeMeta("membership"), "public")).toThrow(/already registered/);
  });

  it("checks meta entries before the outliner so the public path avoids shard materialization", () => {
    // A meta id cannot collide with a sys: outliner id (registration forbids sys: on meta), so
    // checking meta first is unambiguous: a meta hit returns without touching the outliner.
    const outlinerDocs: SyncableDoc[] = [fakeDoc(`${SYS_PREFIX}tree`)];
    const set = new WorkspaceDocSet({
      ...fakeOutliner(outlinerDocs),
      docs: () => {
        throw new Error("outliner.docs() must not be called for a meta-id lookup");
      },
    });
    set.registerMeta(fakeMeta("membership"), "public");

    expect(set.entry("membership")?.securityClass).toBe("public");
  });
});
