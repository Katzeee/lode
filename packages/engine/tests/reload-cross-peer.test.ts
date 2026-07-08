import { describe, expect, it } from "vitest";
import { LoroDoc, LoroMap, LoroText } from "loro-crdt";

/**
 * Phase-1 BLOCKER diagnostic. The engine-layer durability NOTE (in durability.test.ts) once
 * asserted that reloading a shard whose bytes came from a REMOTE peer (a cross-peer
 * `importUpdate`) panics on `LoroText.toDelta`. This file settles it with the one test that
 * removes coexistence — the suspected cause (shared wasm):
 *
 *   A(peerId=1) writes text → B(peerId=2) imports the cross-peer update → B exports shard bytes
 *   → A and B are **freed** (wasm released) → a FRESH C reloads the bytes alone → C reads toDelta.
 *
 * - C reads cleanly  → the engine-layer panic is a shared-wasm coexistence artifact; the full
 *   "sync → restart → read" loop belongs to the daemon e2e (separate processes). Phase 5 skipped.
 * - C panics        → real production bug: a receiver that syncs content, persists, and restarts
 *   crashes on read. Phase 5 is required before sync+persistence can ship.
 *
 * The doc shape + text-style config mirror `ShardedBlockStore.createShardDoc` exactly, so a pass
 * here means the real shard read path is safe; a fail means it isn't.
 */
describe("Phase 1: reload cross-peer shard bytes — toDelta panic?", () => {
  /** Build a shard-shaped doc (entities → entity → content LoroText) with the production text-style
   *  config, matching `ShardedBlockStore.createShardDoc`. */
  const newShardDoc = (peerId?: number): LoroDoc => {
    const d = new LoroDoc();
    if (peerId !== undefined) {
      d.setPeerId(peerId);
    }
    d.configTextStyle({ bold: { expand: "after" }, italic: { expand: "after" } });
    d.getMap("entities");
    return d;
  };

  /** Mount an entity + content LoroText for `nodeId`. `setContainer`/`get` are loosely typed, so the
   *  read-back is annotated `unknown` (the safe top type) and narrowed with `instanceof`. */
  const mountEntity = (d: LoroDoc, nodeId: string): void => {
    d.getMap("entities").setContainer(nodeId, new LoroMap());
    const entity: unknown = d.getMap("entities").get(nodeId);
    if (!(entity instanceof LoroMap)) {
      throw new Error(`entity mount failed for ${nodeId}`);
    }
    entity.setContainer("content", new LoroText());
  };

  const contentTextOf = (d: LoroDoc, nodeId: string): LoroText => {
    const entity: unknown = d.getMap("entities").get(nodeId);
    if (!(entity instanceof LoroMap)) {
      throw new Error(`entity missing for ${nodeId}`);
    }
    const text: unknown = entity.get("content");
    if (!(text instanceof LoroText)) {
      throw new Error(`content missing for ${nodeId}`);
    }
    return text;
  };

  it("fresh reload (sources freed) of a cross-peer snapshot reads toDelta cleanly", () => {
    // A (peerId=1) authors text.
    const A = newShardDoc(1);
    mountEntity(A, "n1");
    contentTextOf(A, "n1").insert(0, "hello cross-peer");
    A.commit();
    const update = A.export({ mode: "update" });

    // B (peerId=2) — the receiver — imports the cross-peer update, then exports the persisted bytes.
    const B = newShardDoc(2);
    B.import(update);
    B.commit();
    const snapshot = B.export({ mode: "snapshot" });

    // The crux: release the source docs' wasm BEFORE reloading. No coexistence.
    A.free();
    B.free();

    // Fresh C reloads the persisted snapshot alone (B restarting reuses peerId=2 — one stable
    // peerId per dataRoot). Then read text — the production read path (getDeltas → toDelta).
    const C = newShardDoc(2);
    C.import(snapshot);
    const delta = contentTextOf(C, "n1").toDelta() as { insert?: unknown }[];
    expect(delta.map((d) => d.insert).join("")).toBe("hello cross-peer");
    C.free();
  });

  it("fresh reload replaying the raw cross-peer UPDATE (no snapshot) reads cleanly", () => {
    // The non-compacted path: C replays the raw cross-peer update bytes directly. Covers the
    // incremental appendUpdate reload path (snapshot is null, updates only).
    const A = newShardDoc(1);
    mountEntity(A, "n2");
    contentTextOf(A, "n2").insert(0, "update-replay");
    A.commit();
    const update = A.export({ mode: "update" });
    A.free();

    const C = newShardDoc(2);
    C.import(update);
    const delta = contentTextOf(C, "n2").toDelta() as { insert?: unknown }[];
    expect(delta.map((d) => d.insert).join("")).toBe("update-replay");
    C.free();
  });
});
