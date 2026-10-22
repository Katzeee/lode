import { describe, expect, it } from "vitest";

import { engineQueryFailure } from "./outcome/index.js";
import { renderFailure } from "./rendering.js";

describe("CLI failure rendering", () => {
  it("uses the failure owner's exit code instead of reclassifying its public code", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const error = engineQueryFailure({
      code: "workspace-not-found",
      message: "Workspace disappeared",
      currentGenerationId: null,
    });

    const exitCode = renderFailure(error, {
      command: "node.show",
      workspace: { ref: "workspace:workspace", label: "Personal" },
      format: "json",
      io: { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
    });

    expect(exitCode).toBe(4);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      workspace: { ref: "workspace:workspace", label: "Personal" },
      error: { code: "target-not-found" },
    });
  });
});
