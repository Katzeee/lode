import { describe, expect, it } from "vitest";

import { descriptor, nodeLabel, resolveNodeTarget, resolveWorkspaceFromList } from "./index.js";
import { parseSelector } from "./selector.js";
import { CliError } from "../outcome/index.js";
import type { DesktopSession } from "../session/index.js";
import type { ProjectionPerspective, ProjectionPageSection, ProjectedNode } from "@lode/sdk";

describe("selector parsing", () => {
  it("recognizes canonical links, typed refs, and bare labels in order", () => {
    expect(parseSelector("lode://workspace/ws-1/node/draft%20two")).toEqual({
      form: "link",
      workspaceId: "ws-1",
      kind: "node",
      identity: "draft two",
    });
    expect(parseSelector("supertag:task")).toEqual({ form: "ref", kind: "supertag", identity: "task" });
    expect(parseSelector("Plain label")).toEqual({ form: "label", label: "Plain label" });
    expect(parseSelector("node:x:y")).toEqual({ form: "ref", kind: "node", identity: "x:y" });
  });

  it("rejects malformed selectors and treats unknown colon prefixes as labels", () => {
    expect(() => parseSelector("lode://workspace/only-two")).toThrow(CliError);
    expect(() => parseSelector("lode://workspace/ws/bogus/x")).toThrow(/unknown kind/u);
    expect(() => parseSelector("node:")).toThrow(/no identity/u);
    expect(parseSelector("Frieren: Beyond Journey's End")).toEqual({
      form: "label",
      label: "Frieren: Beyond Journey's End",
    });
  });

  it("builds one resource descriptor shape for every reusable object", () => {
    const resource = descriptor("ws-1", "node", "draft two", "Draft two");
    expect(resource).toEqual({
      kind: "node",
      id: "draft two",
      ref: "node:draft two",
      link: "lode://workspace/ws-1/node/draft%20two",
      label: "Draft two",
    });
  });
});

function node(nodeId: string, text: string, intrinsic: string | null = null): ProjectedNode {
  return {
    nodeId,
    intrinsicNodeType: intrinsic,
    content:
      text.length === 0 ? [] : [{ kind: "text", id: `${nodeId}#1`, value: text, attributes: {}, factActionId: "c" }],
  } as unknown as ProjectedNode;
}

function sessionWith(
  nodes: readonly ProjectedNode[],
  owners: Readonly<Record<string, string | null>> = {},
): DesktopSession {
  const nodeMap = Object.fromEntries(nodes.map((entry) => [entry.nodeId, entry]));
  return {
    readProjection: async (
      _workspaceId: string,
      _perspective: ProjectionPerspective,
      section: ProjectionPageSection,
    ): Promise<unknown> => {
      await Promise.resolve();
      if (section === "nodes") {
        return nodeMap;
      }
      if (section === "nodeOwners") {
        return owners;
      }
      throw new Error(`unexpected section ${section}`);
    },
  } as unknown as DesktopSession;
}

describe("node target resolution", () => {
  const nodes = [
    node("draft", "Draft", null),
    node("draft-2", "Draft", null),
    node("task", "Task", "supertag-definition"),
  ];
  const owners = { draft: "projects", "draft-2": "notes", task: "library" };

  it("resolves a unique exact label within the allowed kind", async () => {
    const resolved = await resolveNodeTarget(sessionWith(nodes, owners), "ws", "origin", "Task", ["supertag"]);
    expect(resolved.nodeId).toBe("task");
    const [draft] = nodes;
    expect(draft !== undefined && nodeLabel(draft)).toBe("Draft");
  });

  it("fails with candidates on ambiguity and stays silent-free on zero matches", async () => {
    const ambiguity = await resolveNodeTarget(sessionWith(nodes, owners), "ws", "origin", "Draft", ["node"]).catch(
      (error: unknown) => error as CliError,
    );
    expect(ambiguity).toBeInstanceOf(CliError);
    expect((ambiguity as CliError).code).toBe("ambiguous-target");
    expect((ambiguity as CliError).candidates.map((candidate) => candidate.ref).sort()).toEqual([
      "node:draft",
      "node:draft-2",
    ]);
    expect(
      (ambiguity as CliError).candidates.every((candidate) => candidate.link.startsWith("lode://workspace/ws/")),
    ).toBe(true);

    const missing = await resolveNodeTarget(sessionWith(nodes, owners), "ws", "origin", "Nope", ["node"]).catch(
      (error: unknown) => error as CliError,
    );
    expect((missing as CliError).code).toBe("target-not-found");
  });

  it("narrows ambiguity by owner scope before deciding uniqueness", async () => {
    const resolved = await resolveNodeTarget(sessionWith(nodes, owners), "ws", "origin", "Draft", ["node"], {
      underParentIds: ["notes"],
    });
    expect(resolved.nodeId).toBe("draft-2");
  });

  it("accepts typed refs and rejects cross-workspace links", async () => {
    const resolved = await resolveNodeTarget(sessionWith(nodes, owners), "ws", "origin", "node:draft", ["node"]);
    expect(resolved.nodeId).toBe("draft");
    const wrongKind = await resolveNodeTarget(sessionWith(nodes, owners), "ws", "origin", "field:draft", [
      "node",
    ]).catch((error: unknown) => error as CliError);
    expect((wrongKind as CliError).code).toBe("usage");
    const cross = await resolveNodeTarget(
      sessionWith(nodes, owners),
      "ws",
      "origin",
      "lode://workspace/other/node/draft",
      ["node"],
    ).catch((error: unknown) => error as CliError);
    expect((cross as CliError).code).toBe("target-not-found");
    expect((cross as CliError).message).toContain("other");
  });

  it("does not fuzzy-match labels", async () => {
    const failure = await resolveNodeTarget(sessionWith(nodes, owners), "ws", "origin", "Dra", ["node"]).catch(
      (error: unknown) => error as CliError,
    );
    expect((failure as CliError).code).toBe("target-not-found");
  });
});

describe("workspace list resolution", () => {
  const known = [
    { workspaceId: "ws-a", label: "Personal" },
    { workspaceId: "ws-b", label: "Personal" },
    { workspaceId: "ws-c", label: "Tasks" },
  ];

  it("matches by id first, then by unique label, and fails with candidates on duplicate labels", () => {
    expect(resolveWorkspaceFromList(known, "ws-c")).toEqual({ workspaceId: "ws-c", label: "Tasks" });
    expect(resolveWorkspaceFromList(known, "Tasks")).toEqual({ workspaceId: "ws-c", label: "Tasks" });
    expect(() => resolveWorkspaceFromList(known, "Personal")).toThrow(CliError);
    try {
      resolveWorkspaceFromList(known, "Personal");
    } catch (error) {
      expect((error as CliError).code).toBe("ambiguous-target");
      expect((error as CliError).candidates).toHaveLength(2);
    }
  });
});
