import { describe, expect, it } from "vitest";

import { runCli } from "./cli.js";

describe("typed Engine CLI boundary", () => {
  it("rejects requests that do not carry a Workspace identity before dialing", async () => {
    await expect(runCli(["query", "http://localhost:1", "{}"])).rejects.toThrow("workspaceId");
  });

  it("rejects incomplete sync commands before dialing", async () => {
    await expect(runCli(["sync", "http://localhost:1", "workspace"])).rejects.toThrow(
      "remote-endpoint",
    );
  });
});
