import { describe, expect, it } from "vitest";

import { workspaceSchemaNodeId } from "./index.js";

describe("workspace schema identity", () => {
  it("encodes an arbitrary workspace identifier into one unambiguous node identifier", () => {
    expect(workspaceSchemaNodeId("team/work space?#")).toBe("workspace-schema:v1:team%2Fwork%20space%3F%23");
  });
});
