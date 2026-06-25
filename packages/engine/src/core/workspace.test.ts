import { beforeEach, describe, expect, it } from "vitest";
import { Engine } from "./engine.js";
import { Workspace } from "./workspace.js";

let workspace: Workspace;

beforeEach(() => {
  workspace = new Workspace();
});

describe("Workspace", () => {
  it("creates docs with explicit or generated ids", () => {
    let counter = 0;
    const ws = new Workspace({ id: "workspace-main", idGenerator: () => `doc-${++counter}` });

    const generated = ws.createDoc();
    const explicit = ws.createDoc("explicit");

    expect(ws.id).toBe("workspace-main");
    expect(generated).toBeInstanceOf(Engine);
    expect(generated.id).toBe("doc-1");
    expect(explicit.id).toBe("explicit");
    expect(generated.createNode().nodeId.length).toBeGreaterThan(0);
    ws.dispose();
  });

  it("rejects duplicate doc ids and allows reuse after removal", () => {
    workspace.createDoc("doc");

    expect(() => workspace.createDoc("doc")).toThrow(/Doc already exists/);

    workspace.removeDoc("doc");
    expect(workspace.createDoc("doc").id).toBe("doc");
  });

  it("tracks docs independently", () => {
    const a = workspace.createDoc("a");
    const b = workspace.createDoc("b");

    a.createNode();
    workspace.removeDoc("a");

    expect(workspace.getDoc("a")).toBeUndefined();
    expect(workspace.getDoc("b")).toBe(b);
    expect(b.getRootOccurrences()).toHaveLength(0);
  });

  it("emits doc list updates for real mutations only", () => {
    const updates: number[] = [];
    workspace.slots.docListUpdated.subscribe(() => updates.push(1));

    workspace.createDoc("doc");
    workspace.removeDoc("missing");
    workspace.removeDoc("doc");

    expect(updates).toHaveLength(2);
  });

  it("disposes docs and completes the doc list subject", () => {
    let completed = false;
    workspace.slots.docListUpdated.subscribe({ complete: () => (completed = true) });
    workspace.createDoc("a");
    workspace.createDoc("b");

    workspace.dispose();

    expect(workspace.docs.size).toBe(0);
    expect(completed).toBe(true);
  });
});
