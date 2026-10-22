import { describe, expect, it } from "vitest";
import { END_SEQUENCE_ANCHOR as anchor, type EditAction } from "@lode/sdk";
import { openTestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactAuthority } from "./authority/fact-authority.js";

for (const kind of ["ordinary", "template-field-definition"] as const) {
  describe(`${kind} seeded content History`, () => {
    it("restores fragment text with codepoint identities and preserves independent formatting through Undo", async () => {
      const facts = await FactAuthority.open({
        workspaceId: "workspace",
        documents: new InMemoryDocumentStore(),
        loroPeerId: kind === "ordinary" ? "9951" : "9952",
      });
      const workspace = await openTestWorkspace({ workspaceId: "workspace", facts, versions });
      const seed: NonNullable<Extract<EditAction, { kind: "node-create" }>["seed"]> = {
        text: [
          { value: "Node🌱e\u0301", attributes: { bold: true } },
          { value: "", attributes: { italic: true } },
          { value: " plain", attributes: {} },
        ],
      };
      let invocation = 0;
      async function edit(actions: readonly EditAction[], channel = "local") {
        const result = await workspace.execute({
          kind: "edit",
          workspaceId: "workspace",
          actorId: channel,
          invocationId: `seed-${invocation++}`,
          intent: "direct",
          historyChannelId: channel,
          actions,
        });
        expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
      }
      async function atoms() {
        const result = await workspace.query({
          kind: "projection",
          workspaceId: "workspace",
          perspective: "origin",
          section: "nodes",
        });
        if (!("nodes" in result) || !result.nodes.node) {
          throw new Error("Seeded Node is absent");
        }
        return result.nodes.node.content.filter((item) => item.kind === "text");
      }
      async function history(operation: "undo" | "redo") {
        const selection = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "local" });
        if (!(operation in selection) || !selection[operation]) {
          throw new Error(`Missing ${operation}`);
        }
        const result = await workspace.execute({
          kind: operation,
          workspaceId: "workspace",
          actorId: "local",
          invocationId: `seed-history-${invocation++}`,
          selection: selection[operation],
        });
        expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
      }
      await edit(
        kind === "ordinary"
          ? [{ kind: "node-create", nodeId: "node", occurrenceId: "node-occ", parentNodeId: "workspace", anchor, seed }]
          : [
              nodeAt("tag", "workspace", undefined, { intrinsicNodeType: "supertag-definition" }),
              {
                kind: "supertag-template-field-create",
                supertagId: "tag",
                fieldDefinitionId: "node",
                anchor,
                fieldDefinitionSeed: seed,
              },
            ],
        "setup",
      );
      const original = await atoms();
      expect(original.map((atom) => atom.value)).toEqual([..."Node🌱e\u0301 plain"]);
      expect(new Set(original.map((atom) => atom.id)).size).toBe(original.length);
      const ids = original.map((atom) => atom.id);
      await edit([
        { kind: "rich-text-mark", nodeId: "node", atomIds: ids, key: "underline", value: { kind: "set", value: true } },
      ]);
      await edit([{ kind: "rich-text-splice", nodeId: "node", deleteAtomIds: ids, anchor, insert: "Replacement" }]);
      await history("undo");
      const restored = await atoms();
      expect(restored.map((atom) => atom.id)).not.toEqual(ids);
      expect(restored.map((atom) => atom.value)).toEqual(original.map((atom) => atom.value));
      await history("undo");
      expect((await atoms()).map((atom) => ({ value: atom.value, attributes: atom.attributes }))).toEqual(
        original.map((atom) => ({ value: atom.value, attributes: atom.attributes })),
      );
      expect((await atoms()).map((atom) => atom.id)).toEqual(restored.map((atom) => atom.id));
      await history("redo");
      await history("redo");
      expect((await atoms()).map((atom) => atom.value).join("")).toBe("Replacement");
      await workspace.close();
    });
  });
}
