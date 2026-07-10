import { create } from "@bufbuild/protobuf";
import { SessionHelloRequestSchema } from "@lode/protocol/proto";
import { describe, expect, it } from "vitest";
import { generateActorKeypair } from "../../crypto/index.js";
import { SessionIdentity, SessionRequiredError } from "./session-identity.js";

describe("SessionIdentity — resolveCaller (the dispatch-boundary gate)", () => {
  it("resolves the caller's origin + retained keypair for a verified session", () => {
    const identity = new SessionIdentity("node-1");
    const actor = generateActorKeypair();
    identity.createSession(
      "conn-1",
      create(SessionHelloRequestSchema, { mnemonic: "ignored by the manager" }),
      actor,
    );

    const caller = identity.resolveCaller("conn-1");

    expect(caller.origin.nodeId).toBe("node-1");
    expect(caller.origin.actorId).toBe(actor.actorId);
    expect(caller.keypair).toBe(actor);
  });

  it("throws SessionRequiredError without a verified session", () => {
    const identity = new SessionIdentity("node-1");
    expect(() => identity.resolveCaller("missing")).toThrow(SessionRequiredError);
  });
});
