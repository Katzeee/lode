import { describe, expect, it } from "vitest";
import { templateFixture } from "../../../tests/support/workspace/template-fixture.js";
import { nodeAt } from "../../../tests/support/workspace/edit-test-actions.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { syncPair, testFactReplication } from "../../../tests/support/sync.js";

// Tana t61–t67: focus has no write; Enter materializes and inserts in one undoable edit.
describe("structural editing in an inherited Node context", () => {
  it("preserves both authored order and active source order through reopen and Fact replication", async () => {
    const documents = new InMemoryDocumentStore();
    const first = await templateFixture("9984", documents);
    await first.edit([nodeAt("source", "tag", "source-occ", { text: "AlphaOmega" })], "setup");
    await first.edit([
      {
        kind: "template-node-edit",
        ownerNodeId: "one",
        templateNodeId: "source",
        sourcePath: [],
        intents: [
          { kind: "set-content", content: { items: [{ kind: "text", value: "Alpha", attributes: {} }] } },
          {
            kind: "insert-node",
            nodeId: "tail",
            occurrenceId: "tail-occ",
            placement: "after",
            content: { items: [{ kind: "text", value: "Omega", attributes: {} }] },
            supertagIds: [],
          },
        ],
      },
    ]);
    const root = (await first.read("templateNodeInstances")).templateNodeInstances.find(
      (item) => item.ownerNodeId === "one",
    )!.instanceOccurrenceId;
    await first.close();
    const reopened = await templateFixture("9985", documents, false);
    const replica = await templateFixture("9986", undefined, false);
    try {
      await reopened.history("undo");
      await reopened.history("redo");
      await syncPair(testFactReplication(reopened.facts.replication), testFactReplication(replica.facts.replication));
      await replica.workspace.reconcileAuthorityAdvance();
      for (const fixture of [reopened, replica]) {
        expect((await fixture.read("authoredChildOccurrences")).authoredChildOccurrences.one).toEqual([
          "tail-occ",
          root,
        ]);
        expect((await fixture.read("childOccurrences")).childOccurrences.one).toEqual([root, "tail-occ"]);
      }
      await assertAuthoredMoveReview(replica, root);
      await replica.edit([{ kind: "supertag-remove", hostNodeId: "one", supertagId: "tag" }]);
      expect((await replica.read("childOccurrences")).childOccurrences.one).toEqual(["tail-occ", root]);
    } finally {
      await reopened.close();
      await replica.close();
    }
  });

  it.each(["child", "after"] as const)(
    "inserts %s while preserving the source, copied children and redo identities",
    async (placement) => {
      const f = await templateFixture(placement === "child" ? "9982" : "9983");
      try {
        await f.edit(
          [
            nodeAt("source", "tag", "source-occ", { text: "AlphaOmega" }),
            nodeAt("child", "source", "child-occ", { text: "Nested child" }),
          ],
          "setup",
        );
        const before = (await f.read("nodes")).nodes;
        await f.edit([
          {
            kind: "template-node-edit",
            ownerNodeId: "one",
            templateNodeId: "source",
            sourcePath: [],
            intents: [
              ...(placement === "after"
                ? [
                    {
                      kind: "set-content" as const,
                      content: { items: [{ kind: "text" as const, value: "Alpha", attributes: {} }] },
                    },
                  ]
                : []),
              {
                kind: "insert-node",
                nodeId: "inserted",
                occurrenceId: "inserted-occ",
                placement,
                content: { items: placement === "child" ? [] : [{ kind: "text", value: "Omega", attributes: {} }] },
                supertagIds: [],
              },
            ],
          },
        ]);
        const instance = (await f.read("templateNodeInstances")).templateNodeInstances.find(
          (item) => item.ownerNodeId === "one",
        )!;
        const child = instance.copies.find((item) => item.sourceNodeId === "child")!;
        const root = instance.instanceNodeId!;
        const authoredOrder =
          placement === "child" ? [instance.instanceOccurrenceId] : ["inserted-occ", instance.instanceOccurrenceId];
        expect((await f.read("authoredChildOccurrences")).authoredChildOccurrences.one).toEqual(authoredOrder);
        const nodes = (await f.read("nodes")).nodes;
        const text = (id: string) =>
          nodes[id]?.content.flatMap((item) => (item.kind === "text" ? [item.value] : [])).join("");
        expect(text(root)).toBe(placement === "child" ? "AlphaOmega" : "Alpha");
        expect(text("inserted")).toBe(placement === "child" ? "" : "Omega");
        expect(nodes.source).toEqual(before.source);
        expect(nodes.child).toEqual(before.child);
        expect((await f.read("nodeOwners")).nodeOwners.inserted).toBe(placement === "child" ? root : "one");
        expect((await f.read("childOccurrences")).childOccurrences[root]).toEqual(
          placement === "child" ? ["inserted-occ", child.instanceOccurrenceId] : [child.instanceOccurrenceId],
        );
        expect(
          (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "two")
            ?.state,
        ).toBe("linked");
        await f.history("undo");
        expect(
          (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "one")
            ?.state,
        ).toBe("linked");
        const trash = (await f.read("workspaceSystemNodes")).workspaceSystemNodes.trash;
        expect((await f.read("nodeOwners")).nodeOwners.inserted).toBe(trash);
        await f.history("redo");
        expect((await f.read("authoredChildOccurrences")).authoredChildOccurrences.one).toEqual(authoredOrder);
        expect(
          (await f.read("templateNodeInstances")).templateNodeInstances.find((item) => item.ownerNodeId === "one")
            ?.copies,
        ).toEqual(instance.copies);
        expect((await f.read("nodeOwners")).nodeOwners.inserted).toBe(placement === "child" ? root : "one");
        if (placement === "after") {
          expect((await f.read("childOccurrences")).childOccurrences.one).toEqual([
            instance.instanceOccurrenceId,
            "inserted-occ",
          ]);
          await f.edit([{ kind: "supertag-remove", hostNodeId: "one", supertagId: "tag" }]);
          expect((await f.read("childOccurrences")).childOccurrences.one).toEqual([
            "inserted-occ",
            instance.instanceOccurrenceId,
          ]);
          await f.history("undo");
          expect((await f.read("childOccurrences")).childOccurrences.one).toEqual([
            instance.instanceOccurrenceId,
            "inserted-occ",
          ]);
          expect((await f.read("authoredChildOccurrences")).authoredChildOccurrences.one).toEqual(authoredOrder);
          await f.history("redo");
          expect((await f.read("childOccurrences")).childOccurrences.one).toEqual(authoredOrder);
        }
      } finally {
        await f.close();
      }
    },
  );
});

async function assertAuthoredMoveReview(fixture: Awaited<ReturnType<typeof templateFixture>>, root: string) {
  await fixture.edit(
    [
      {
        kind: "occurrence-move",
        occurrenceId: "tail-occ",
        parentNodeId: "one",
        anchor: { after: root, before: null, affinity: "after", fallback: "end" },
      },
    ],
    "order-proposal",
    "proposal",
  );
  const proposed = await fixture.workspace.query({
    kind: "projection",
    workspaceId: "workspace",
    perspective: "review",
    section: "childOccurrences",
  });
  expect(proposed).toMatchObject({ childOccurrences: { one: [root, "tail-occ"] } });
  const review = await fixture.workspace.query({ kind: "review", workspaceId: "workspace" });
  if (!("hunks" in review)) {
    throw new Error("Expected Review");
  }
  const hunk = review.hunks.find((item) =>
    item.evidence.effects.some((effect) => effect.kind === "structure" && effect.occurrenceId === "tail-occ"),
  );
  expect(hunk, "Effective source ordering does not hide a proposed authored placement change").toBeDefined();
  expect(
    await fixture.workspace.execute({
      kind: "resolve-review",
      workspaceId: "workspace",
      actorId: "reviewer",
      invocationId: "reject-authored-order",
      decision: "reject",
      selection: hunk!.selection,
    }),
  ).toMatchObject({ status: "published" });
}
