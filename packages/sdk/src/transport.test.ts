import { create } from "@bufbuild/protobuf";
import { WriteResultSchema } from "@lode/protocol/proto";
import { describe, expect, it } from "vitest";
import { createTransportEngineApplication, type EngineTransport } from "./transport.js";

const command = {
  kind: "finalize-deletions",
  workspaceId: "workspace",
  invocationId: "invocation",
  actorId: "actor",
  nodeIds: ["node"],
} as const;

describe("transport application failure boundary", () => {
  it("returns an invalid-input result for an expected validation failure", async () => {
    const application = createTransportEngineApplication(transport(() => Promise.reject(new Error("unused"))));
    await expect(application.execute({ ...command, nodeIds: [] })).resolves.toMatchObject({
      status: "rejected",
      error: { code: "invalid-input" },
    });
  });

  it("does not hide an unexpected command property failure as invalid input", async () => {
    const failure = new Error("command property trap");
    const trapped = new Proxy(command, {
      get(target, property, receiver) {
        if (property === "workspaceId") {
          throw failure;
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const application = createTransportEngineApplication(transport(() => Promise.reject(new Error("unused"))));
    await expect(application.execute(trapped)).rejects.toBe(failure);
  });

  it("reports an ambiguous transport failure as outcome unknown", async () => {
    const application = createTransportEngineApplication(
      transport(() => Promise.resolve({ status: "outcome-unknown" })),
    );
    await expect(application.execute(command)).resolves.toEqual({
      status: "outcome-unknown",
      invocationId: "invocation",
    });
  });

  it("does not hide a malformed transport response as an ambiguous commit", async () => {
    const application = createTransportEngineApplication(
      transport(() => Promise.resolve({ status: "response", message: create(WriteResultSchema) })),
    );
    await expect(application.execute(command)).rejects.toThrow();
  });

  it("does not reinterpret an unexpected transport implementation error", async () => {
    const application = createTransportEngineApplication(transport(() => Promise.reject(new Error("codec bug"))));
    await expect(application.execute(command)).rejects.toThrow("codec bug");
  });
});

function transport(execute: EngineTransport["execute"]): EngineTransport {
  return {
    execute,
    query: () => Promise.reject(new Error("query is not part of this test")),
    subscribe: () => () => undefined,
  };
}
