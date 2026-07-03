import { create } from "@bufbuild/protobuf";
import { SessionHelloRequestSchema } from "@lode/protocol/proto";
import { describe, expect, it } from "vitest";
import { generateActorKeypair } from "../utils/crypto/index.js";
import { SessionManager, SessionRequiredError } from "./session-manager.js";

describe("SessionManager — getActorPublicKeys", () => {
  it("returns the session actor's id + sign pub (retained at createSession)", () => {
    const sessions = new SessionManager("node-1");
    const actor = generateActorKeypair();
    sessions.createSession(
      "conn-1",
      create(SessionHelloRequestSchema, { mnemonic: "ignored by the manager" }),
      actor,
    );
    expect(sessions.getActorPublicKeys("conn-1")).toEqual({
      actorId: actor.actorId,
      signPub: actor.publicKey,
    });
  });

  it("retains the full keypair (createWorkspace signs as this actor)", () => {
    const sessions = new SessionManager("node-1");
    const actor = generateActorKeypair();
    sessions.createSession("conn-1", create(SessionHelloRequestSchema, { mnemonic: "x" }), actor);
    expect(sessions.getActorKeypair("conn-1")).toEqual({ actorId: actor.actorId, keypair: actor });
  });

  it("throws SessionRequiredError without a verified session", () => {
    const sessions = new SessionManager("node-1");
    expect(() => sessions.getActorPublicKeys("missing")).toThrow(SessionRequiredError);
  });
});
