import { describe, expect, it } from "vitest";

import type { EngineCommand } from "@lode/sdk";
import { createWorkspaceApplication } from "./workspace-application.js";

const command = {
  kind: "finalize-deletions",
  workspaceId: "workspace",
  invocationId: "invocation",
  actorId: "actor",
  nodeIds: ["node"],
} as const;

describe("Workspace application input failure authority", () => {
  it("returns invalid-input for an expected validation failure", async () => {
    const application = createWorkspaceApplication({ resolve: () => undefined, stopRequested: () => false });
    await expect(application.execute({ ...command, nodeIds: [] })).resolves.toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });
  });

  it("does not hide an unexpected property failure as invalid input", () => {
    const failure = new Error("workspace command property trap");
    const trapped = new Proxy(command, {
      get(target, property, receiver) {
        if (property === "workspaceId") {
          throw failure;
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as EngineCommand;
    const application = createWorkspaceApplication({ resolve: () => undefined, stopRequested: () => false });
    expect(() => application.execute(trapped)).toThrow(failure);
  });
});
