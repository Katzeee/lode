import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";

/**
 * Toolchain smoke test: confirms the isolated experiments folder can resolve
 * loro-crdt and vitest from the monorepo root node_modules (Node upward
 * resolution) without being a workspace package. Green = foundation is sound.
 */
describe("toolchain", () => {
  it("resolves loro-crdt and manipulates a movable tree", () => {
    const doc = new LoroDoc();
    const tree = doc.getTree("occurrences");
    const root = tree.createNode();
    root.data.set("nodeId", "n-root");
    const child = tree.createNode(root.id, 0);
    child.data.set("nodeId", "n-child");
    doc.commit();

    const live = tree.getNodes({ withDeleted: false });
    expect(live).toHaveLength(2);
    expect(String(child.id)).not.toBe(String(root.id));
    expect(root.children()?.map((n) => n.data.get("nodeId"))).toEqual(["n-child"]);
  });

  it("round-trips a snapshot + update across two LoroDocs", () => {
    const a = new LoroDoc();
    const treeA = a.getTree("occurrences");
    const node = treeA.createNode();
    node.data.set("nodeId", "n1");
    a.commit();

    const snapshot = a.export({ mode: "snapshot" });
    const before = a.version();

    node.data.set("nodeId", "n1-updated");
    a.commit();
    const update = a.export({ mode: "update", from: before });

    const b = new LoroDoc();
    b.import(snapshot);
    b.import(update);
    const treeB = b.getTree("occurrences");
    const live = treeB.getNodes({ withDeleted: false });
    expect(live).toHaveLength(1);
    expect(live[0]?.data.get("nodeId")).toBe("n1-updated");
  });
});
