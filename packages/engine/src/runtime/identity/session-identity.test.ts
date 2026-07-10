import { create } from "@bufbuild/protobuf";
import { SessionHelloRequestSchema } from "@lode/protocol/proto";
import { describe, expect, it } from "vitest";
import { generateActorKeypair } from "../../utils/crypto/index.js";
import { SessionIdentity, SessionRequiredError } from "./session-identity.js";

describe("SessionIdentity — actor keys", () => {
  it("returns the session actor's id + sign pub (retained at createSession)", () => {
    const identity = new SessionIdentity("node-1");
    const actor = generateActorKeypair();
    identity.createSession(
      "conn-1",
      create(SessionHelloRequestSchema, { mnemonic: "ignored by the manager" }),
      actor,
    );
    expect(identity.getActorPublicKeys("conn-1")).toEqual({
      actorId: actor.actorId,
      signPub: actor.publicKey,
    });
  });

  it("retains the full keypair (createWorkspace signs as this actor)", () => {
    const identity = new SessionIdentity("node-1");
    const actor = generateActorKeypair();
    identity.createSession("conn-1", create(SessionHelloRequestSchema, { mnemonic: "x" }), actor);
    expect(identity.getActorKeypair("conn-1")).toEqual({ actorId: actor.actorId, keypair: actor });
  });

  it("throws SessionRequiredError without a verified session", () => {
    const identity = new SessionIdentity("node-1");
    expect(() => identity.getActorPublicKeys("missing")).toThrow(SessionRequiredError);
  });
});
