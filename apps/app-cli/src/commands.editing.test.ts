import { describe, expect, it } from "vitest";
import { executeCommand } from "./commands.js";
import { command, createFakeClient, Methods } from "./commands.test-helpers.js";

describe("executeCommand: node editing ops", () => {
  it("paste maps repeated --occ sources + --target-occ + --index", async () => {
    const { client, calls } = createFakeClient();
    const summary = await executeCommand(
      client,
      command("node", "paste", {
        "--occ": ["occ_a", "occ_b"],
        "--target-occ": ["occ_t"],
        "--index": ["2"],
      }),
    );
    expect(calls).toContainEqual({
      method: Methods.PasteNodes,
      params: {
        workspaceId: "ws_main",
        sourceOccurrenceIds: ["occ_a", "occ_b"],
        targetParentOccurrenceId: "occ_t",
        index: 2,
      },
    });
    expect(summary).toContain("2 occurrence(s)");
  });

  it("duplicate maps a single --occ", async () => {
    const { client, calls } = createFakeClient();
    const summary = await executeCommand(
      client,
      command("node", "duplicate", { "--occ": ["occ_a"] }),
    );
    expect(calls).toContainEqual({
      method: Methods.DuplicateNode,
      params: { workspaceId: "ws_main", occurrenceId: "occ_a" },
    });
    expect(summary).toContain("occ_clone");
  });

  it("indent maps repeated --occ", async () => {
    const { client, calls } = createFakeClient();
    await executeCommand(client, command("node", "indent", { "--occ": ["occ_a", "occ_b"] }));
    expect(calls).toContainEqual({
      method: Methods.IndentNodes,
      params: { workspaceId: "ws_main", occurrenceIds: ["occ_a", "occ_b"] },
    });
  });

  it("move-up maps to moveSiblingNode with up=true", async () => {
    const { client, calls } = createFakeClient();
    await executeCommand(client, command("node", "move-up", { "--occ": ["occ_a"] }));
    expect(calls).toContainEqual({
      method: Methods.MoveSiblingNode,
      params: { workspaceId: "ws_main", occurrenceId: "occ_a", up: true },
    });
  });

  it("outdent maps a single --occ", async () => {
    const { client, calls } = createFakeClient();
    await executeCommand(client, command("node", "outdent", { "--occ": ["occ_a"] }));
    expect(calls).toContainEqual({
      method: Methods.OutdentNode,
      params: { workspaceId: "ws_main", occurrenceId: "occ_a" },
    });
  });
});
