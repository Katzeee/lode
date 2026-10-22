import { describe, expect, it } from "vitest";
import {
  END_SEQUENCE_ANCHOR as anchor,
  type EditAction,
  type EngineCommand,
  type ProjectionPage,
  type ProjectionPageSection,
} from "@lode/sdk";
import { openTestWorkspace, type TestWorkspace } from "../../../tests/support/workspace/open-test-workspace.js";
import { InMemoryDocumentStore } from "../../../tests/support/document-store.js";
import { nodeAt, createSupertagApplication } from "../../../tests/support/workspace/edit-test-actions.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../domain/reconcile/index.js";
import { FactAuthority } from "./authority/fact-authority.js";

const conversion: EditAction = { kind: "node-convert-to-supertag", nodeId: "parent" };

describe("ordinary Node conversion to a Supertag Definition", () => {
  it("preserves the existing Node graph and exposes its existing content to fresh applications", async () => {
    const f = await fixture("9970");
    const before = await graph(f.workspace);
    await f.edit([conversion]);
    const after = await graph(f.workspace);
    expect(after.nodes.parent).toEqual({ ...before.nodes.parent, intrinsicNodeType: "supertag-definition" });
    expect(after.nodes.child).toEqual(before.nodes.child);
    expect(after.owners).toEqual(before.owners);
    expect(after.occurrences).toEqual(before.occurrences);
    expect(after.children).toEqual(before.children);
    expect((await read(f.workspace, "supertagTemplateNodes")).supertagTemplateNodes.parent).toEqual(["child"]);
    expect(
      f.facts
        .snapshot()
        .facts.flatMap((fact) =>
          fact.body.kind === "action" ? fact.body.actions.filter((action) => action.kind === "node-create") : [],
        )
        .filter((action) => action.kind === "node-create" && action.nodeId === "parent"),
    ).toHaveLength(1);
    await f.edit([createSupertagApplication("one", "parent"), createSupertagApplication("two", "parent")]);
    const instances = (await read(f.workspace, "templateNodeInstances")).templateNodeInstances;
    expect(
      instances
        .filter((item) => item.templateNodeId === "child")
        .map((item) => [item.ownerNodeId, item.state, item.instanceNodeId]),
    ).toEqual([
      ["one", "linked", null],
      ["two", "linked", null],
    ]);
    expect((await read(f.workspace, "nodeOwners")).nodeOwners.child).toBe("parent");
    expect(await f.history("undo")).toMatchObject({ status: "published" });
    expect(await f.history("undo")).toMatchObject({ status: "published" });
    expect((await read(f.workspace, "nodes")).nodes.parent?.intrinsicNodeType).toBe(null);
    expect((await read(f.workspace, "childOccurrences")).childOccurrences.parent).toEqual(["child-original"]);
    expect(await f.history("redo")).toMatchObject({ status: "published" });
    expect(await f.history("redo")).toMatchObject({ status: "published" });
    expect(
      (await read(f.workspace, "templateNodeInstances")).templateNodeInstances.filter(
        (item) => item.templateNodeId === "child",
      ),
    ).toHaveLength(2);
    await f.workspace.close();
  });

  it("undoes and redoes the role while preserving later ordinary content edits and identity", async () => {
    const f = await fixture("9971");
    await f.edit([conversion]);
    await f.edit(
      [{ kind: "rich-text-splice", nodeId: "parent", deleteAtomIds: [], anchor, insert: " revised" }],
      "other",
    );
    for (const [operation, type] of [
      ["undo", null],
      ["redo", "supertag-definition"],
      ["undo", null],
      ["redo", "supertag-definition"],
    ] as const) {
      expect(await f.history(operation)).toMatchObject({ status: "published" });
      const state = await graph(f.workspace);
      expect(state.nodes.parent?.intrinsicNodeType).toBe(type);
      expect(state.nodes.parent?.content.flatMap((item) => (item.kind === "text" ? [item.value] : [])).join("")).toBe(
        "Parent revised",
      );
      expect(state.owners.parent).toBe("workspace");
      expect(state.children.parent).toEqual(["child-original"]);
      expect(state.occurrences["parent-reference"]).toMatchObject({ nodeId: "parent", parentNodeId: "one" });
    }
    await f.workspace.close();
  });

  it("protects a different channel's later use of the converted role", async () => {
    const f = await fixture("9972");
    await f.edit([conversion]);
    await f.edit([createSupertagApplication("one", "parent")], "other");
    expect(await f.history("undo")).toMatchObject({ status: "rejected", error: { code: "stale-selection" } });
    expect((await read(f.workspace, "nodes")).nodes.parent?.intrinsicNodeType).toBe("supertag-definition");
    expect((await read(f.workspace, "supertagApplications")).supertagApplications.one).toHaveLength(1);
    await f.workspace.close();
  });

  it("binds later uses to the current conversion rather than a previously revoked role", async () => {
    const f = await fixture("9979");
    await f.edit([conversion]);
    expect(await f.history("undo")).toMatchObject({ status: "published" });
    await f.edit([conversion]);
    await f.edit([createSupertagApplication("one", "parent")], "other");
    expect(await f.history("undo")).toMatchObject({ status: "rejected", error: { code: "stale-selection" } });
    expect((await read(f.workspace, "supertagApplications")).supertagApplications.one).toHaveLength(1);
    expect((await read(f.workspace, "nodes")).nodes.parent?.intrinsicNodeType).toBe("supertag-definition");
    await f.workspace.close();
  });

  for (const decision of ["accept", "reject"] as const) {
    it(`${decision}s a proposed role with its dependent direct application and preserves the original graph`, async () => {
      const f = await fixture(decision === "accept" ? "9973" : "9974");
      await f.edit([conversion], "local", "proposal");
      expect((await read(f.workspace, "nodes")).nodes.parent?.intrinsicNodeType).toBe(null);
      expect((await read(f.workspace, "nodes", "review")).nodes.parent?.intrinsicNodeType).toBe("supertag-definition");
      await f.edit([createSupertagApplication("one", "parent")], "other");
      expect((await read(f.workspace, "supertagApplications")).supertagApplications.one ?? []).toEqual([]);
      expect((await read(f.workspace, "supertagApplications", "review")).supertagApplications.one).toHaveLength(1);
      const review = await f.workspace.query({ kind: "review", workspaceId: "workspace" });
      if (!("hunks" in review)) {
        throw new Error("Review unavailable");
      }
      const hunk = review.hunks.find((item) =>
        item.evidence.effects.some((effect) => effect.kind === "intrinsic-node-type" && effect.identity === "parent"),
      );
      if (!hunk) {
        throw new Error("Role conversion review effect absent");
      }
      expect(hunk.evidence.associatedImpactIds).toContain("parent");
      expect(
        await f.workspace.execute({
          kind: "resolve-review",
          workspaceId: "workspace",
          actorId: "reviewer",
          invocationId: `resolve-${decision}`,
          decision,
          selection: hunk.selection,
        }),
      ).toMatchObject({ status: "published" });
      expect((await read(f.workspace, "nodes")).nodes.parent?.intrinsicNodeType).toBe(
        decision === "accept" ? "supertag-definition" : null,
      );
      expect((await read(f.workspace, "supertagApplications")).supertagApplications.one ?? []).toHaveLength(
        decision === "accept" ? 1 : 0,
      );
      expect((await read(f.workspace, "childOccurrences")).childOccurrences.parent).toEqual(["child-original"]);
      await f.workspace.close();
    });
  }

  it("replays the role from persistence and Fact-only replication without recreating the Node", async () => {
    const documents = new InMemoryDocumentStore();
    const f = await fixture("9975", documents);
    await f.edit([conversion]);
    const replicated = new InMemoryDocumentStore();
    await replicated.appendUpdate("facts", await f.facts.replication.exportUpdate());
    await f.workspace.close();
    for (const [peer, store] of [
      ["9976", documents],
      ["9977", replicated],
    ] as const) {
      const opened = await fixture(peer, store, false);
      expect((await read(opened.workspace, "nodes")).nodes.parent?.intrinsicNodeType).toBe("supertag-definition");
      expect((await read(opened.workspace, "childOccurrences")).childOccurrences.parent).toEqual(["child-original"]);
      expect(await opened.history("undo")).toMatchObject({ status: "published" });
      expect((await read(opened.workspace, "nodes")).nodes.parent?.intrinsicNodeType).toBe(null);
      await opened.workspace.close();
    }
  });

  it("does not expose arbitrary conversion or the internal role compensation operations", async () => {
    const f = await fixture("9978");
    await f.edit(
      [
        nodeAt("field", "workspace", undefined, { intrinsicNodeType: "field-definition" }),
        nodeAt("deleted", "workspace"),
        { kind: "node-delete", nodeId: "deleted" },
      ],
      "setup",
    );
    for (const nodeId of ["workspace", "field", "deleted", "absent"]) {
      expect(await f.execute([{ kind: "node-convert-to-supertag", nodeId }])).toMatchObject({ status: "rejected" });
    }
    await f.edit([conversion]);
    expect(await f.execute([conversion])).toMatchObject({ status: "rejected" });
    expect(
      await f.execute([
        { kind: "supertag-role-remove", nodeId: "parent", roleActionId: "forged" },
      ] as unknown as readonly EditAction[]),
    ).toMatchObject({ status: "rejected" });
    await f.workspace.close();
  });
});

async function fixture(loroPeerId: `${number}`, documents = new InMemoryDocumentStore(), setup = true) {
  const facts = await FactAuthority.open({ workspaceId: "workspace", documents, loroPeerId });
  const workspace = await openTestWorkspace({ workspaceId: "workspace", facts, versions });
  let invocation = 0;
  async function execute(actions: readonly EditAction[], channel = "local", intent: "direct" | "proposal" = "direct") {
    const command: EngineCommand = {
      kind: "edit",
      workspaceId: "workspace",
      actorId: channel,
      invocationId: `${loroPeerId}-${invocation++}`,
      intent,
      historyChannelId: channel,
      actions,
    };
    return workspace.execute(command);
  }
  async function edit(actions: readonly EditAction[], channel = "local", intent: "direct" | "proposal" = "direct") {
    const result = await execute(actions, channel, intent);
    expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
  }
  if (setup) {
    await edit(
      [
        nodeAt("parent", "workspace", undefined, { text: "Parent" }),
        nodeAt("child", "parent", undefined, { text: "Child" }),
        nodeAt("one", "workspace"),
        nodeAt("two", "workspace"),
        { kind: "occurrence-create", occurrenceId: "parent-reference", nodeId: "parent", parentNodeId: "one", anchor },
      ],
      "setup",
    );
  }
  return {
    workspace,
    facts,
    edit,
    execute,
    history: async (operation: "undo" | "redo") => {
      const history = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "local" });
      if (!(operation in history) || !history[operation]) {
        throw new Error(`Missing ${operation}`);
      }
      return workspace.execute({
        kind: operation,
        workspaceId: "workspace",
        actorId: "local",
        invocationId: `${loroPeerId}-history-${invocation++}`,
        selection: history[operation],
      });
    },
  };
}
async function read<S extends ProjectionPageSection>(
  workspace: TestWorkspace,
  section: S,
  perspective: "origin" | "review" = "origin",
): Promise<ProjectionPage<S>> {
  const result = await workspace.query({ kind: "projection", workspaceId: "workspace", perspective, section });
  if (!("section" in result) || result.section !== section) {
    throw new Error(`Missing ${section}`);
  }
  return result as ProjectionPage<S>;
}
async function graph(workspace: TestWorkspace) {
  return {
    nodes: (await read(workspace, "nodes")).nodes,
    owners: (await read(workspace, "nodeOwners")).nodeOwners,
    occurrences: (await read(workspace, "occurrences")).occurrences,
    children: (await read(workspace, "childOccurrences")).childOccurrences,
  };
}
