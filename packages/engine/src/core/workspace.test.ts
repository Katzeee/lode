import { beforeEach, describe, expect, it } from "vitest";
import { Engine } from "./engine.js";
import { Workspace } from "./workspace.js";

let workspace: Workspace;

beforeEach(() => {
  workspace = new Workspace();
});

describe("Workspace (one outliner engine)", () => {
  it("creates an engine and exposes it via .engine", () => {
    const ws = new Workspace({ id: "ws-main" });
    expect(ws.engine).toBeNull();
    const engine = ws.createEngine();
    expect(ws.id).toBe("ws-main");
    expect(engine).toBeInstanceOf(Engine);
    expect(ws.engine).toBe(engine);
    expect(engine.createNode().nodeId.length).toBeGreaterThan(0);
    ws.dispose();
  });

  it("rejects a second engine — one outliner per workspace", () => {
    workspace.createEngine();
    expect(() => workspace.createEngine()).toThrow(/already has an engine/);
    expect(workspace.engine).toBeInstanceOf(Engine);
  });

  it("dispose drops the engine and allows a fresh create", () => {
    workspace.createEngine();
    workspace.dispose();
    expect(workspace.engine).toBeNull();
    expect(workspace.createEngine()).toBeInstanceOf(Engine);
  });
});
