import { describe, expect, it } from "vitest";

import type { EngineContract } from "@lode/engine";
import { createInProcessClient } from "./app-server-client.js";

describe("in-process EngineContract adapter", () => {
  it("uses the same contract without exposing the runtime", async () => {
    const engine: EngineContract = {
      execute: () =>
        Promise.resolve({
          status: "rejected",
          error: { code: "invalid-input", message: "fixture", currentGenerationId: null },
        }),
      query: () =>
        Promise.resolve({
          status: "rejected",
          error: { code: "invalid-input", message: "fixture", currentGenerationId: null },
        }),
      subscribe: () => () => {},
    };
    const opened: string[] = [];
    const client = createInProcessClient({
      engine,
      openWorkspace: (workspaceId) => {
        opened.push(workspaceId);
        return Promise.resolve();
      },
    });
    await client.openWorkspace("workspace");
    expect(Object.keys(client.engine).sort()).toEqual(["execute", "query", "subscribe"]);
    expect(opened).toEqual(["workspace"]);
    expect(client.engine).toBe(engine);
  });
});
