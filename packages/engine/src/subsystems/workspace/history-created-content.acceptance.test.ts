import { describe, expect, it } from "vitest";
import { END_SEQUENCE_ANCHOR as anchor, type EditAction } from "@lode/sdk";
import { openTestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactAuthority } from "./authority/fact-authority.js";

describe("History of atomic Node and content creation", () => {
  for (const independentlyDeleted of [false, true]) {
    it(
      independentlyDeleted
        ? "does not edit content kept in Trash by another channel"
        : "restores Node identity, text, and inline references together on Redo",
      async () => {
        const facts = await FactAuthority.open({
          workspaceId: "workspace",
          documents: new InMemoryDocumentStore(),
          loroPeerId: independentlyDeleted ? "9991" : "9990",
        });
        const workspace = await openTestWorkspace({ workspaceId: "workspace", facts, versions });
        let invocation = 0;
        async function edit(actions: readonly EditAction[], channel = "local") {
          const result = await workspace.execute({
            kind: "edit",
            workspaceId: "workspace",
            actorId: channel,
            invocationId: `create-${invocation++}`,
            intent: "direct",
            historyChannelId: channel,
            actions,
          });
          expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
        }
        async function state() {
          const nodes = await workspace.query({
            kind: "projection",
            workspaceId: "workspace",
            perspective: "origin",
            section: "nodes",
          });
          const owners = await workspace.query({
            kind: "projection",
            workspaceId: "workspace",
            perspective: "origin",
            section: "nodeOwners",
          });
          if (!("nodes" in nodes) || !("nodeOwners" in owners)) {
            throw new Error("Node projections absent");
          }
          return { node: nodes.nodes.created, owner: owners.nodeOwners.created };
        }
        async function history(operation: "undo" | "redo") {
          const result = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "local" });
          if (!(operation in result) || !result[operation]) {
            throw new Error(`Missing ${operation}`);
          }
          return workspace.execute({
            kind: operation,
            workspaceId: "workspace",
            actorId: "local",
            invocationId: `history-${invocation++}`,
            selection: result[operation],
          });
        }
        await edit([nodeAt("target", "workspace")], "setup");
        await edit([
          nodeAt("created", "workspace", "created-occurrence"),
          { kind: "rich-text-splice", nodeId: "created", deleteAtomIds: [], anchor, insert: "Hello🌱" },
          {
            kind: "inline-reference-create",
            inlineReferenceId: "reference",
            hostNodeId: "created",
            targetNodeId: "target",
            anchor,
          },
        ]);
        if (independentlyDeleted) {
          await edit([{ kind: "node-delete", nodeId: "created" }], "other");
          const before = await state();
          expect(await history("undo")).toMatchObject({ status: "rejected", error: { code: "history-unavailable" } });
          expect(await state()).toEqual(before);
        } else {
          for (let round = 0; round < 3; round += 1) {
            expect(await history("undo")).toMatchObject({ status: "published" });
            expect((await state()).node?.content).toEqual([]);
            expect(await history("redo")).toMatchObject({ status: "published" });
            const current = await state();
            expect(current.owner).toBe("workspace");
            expect(
              current.node?.content.map((item) => (item.kind === "text" ? item.value : [item.id, item.targetNodeId])),
            ).toEqual([..."Hello🌱", ["reference", "target"]]);
          }
        }
        await workspace.close();
      },
    );
  }
});
