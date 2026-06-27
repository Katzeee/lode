import { beforeEach, describe, expect, it } from "vitest";
import { Engine } from "./engine.js";
import { Workspace } from "./workspace.js";

let workspace: Workspace;

beforeEach(() => {
  workspace = new Workspace();
});

describe("Workspace (one engine per workspace)", () => {
  it("creates a doc with an explicit or generated id", () => {
    let counter = 0;
    const ws = new Workspace({ id: "ws-main", idGenerator: () => `doc-${++counter}` });

    const generated = ws.createDoc();

    expect(ws.id).toBe("ws-main");
    expect(generated).toBeInstanceOf(Engine);
    expect(generated.id).toBe("doc-1");
    expect(generated.createNode().nodeId.length).toBeGreaterThan(0);
    ws.dispose();
  });

  it("rejects a second doc — one engine per workspace", () => {
    workspace.createDoc("main");
    expect(() => workspace.createDoc("other")).toThrow(/one engine per workspace/);
    expect(workspace.docs.size).toBe(1);
  });

  it("allows recreate after remove", () => {
    workspace.createDoc("doc");
    workspace.removeDoc("doc");
    expect(workspace.createDoc("doc").id).toBe("doc");
  });

  it("getDoc returns the single engine", () => {
    const engine = workspace.createDoc("main");
    expect(workspace.getDoc("main")).toBe(engine);
    expect(workspace.getDoc("nonexistent")).toBeUndefined();
  });

  it("emits doc list updates for real mutations only", () => {
    const updates: number[] = [];
    workspace.slots.docListUpdated.subscribe(() => updates.push(1));

    workspace.createDoc("doc");
    workspace.removeDoc("missing"); // no-op
    workspace.removeDoc("doc");

    expect(updates).toHaveLength(2); // create + remove
  });

  it("disposes the engine and completes the doc list subject", () => {
    let completed = false;
    workspace.slots.docListUpdated.subscribe({ complete: () => (completed = true) });
    workspace.createDoc("main");

    workspace.dispose();

    expect(workspace.docs.size).toBe(0);
    expect(completed).toBe(true);
  });
});
