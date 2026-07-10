import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import {
  ActorSchema,
  SessionInfoSchema,
  type Actor,
  type ClientInfo,
  type SessionHelloRequest,
  type SessionInfo,
} from "@lode/protocol/proto";
import type { EngineOrigin, ResolvedCaller } from "../../caller.js";
import type { ActorKeypair } from "../../utils/crypto/index.js";

// Engine-internal typed error: the daemon (Connect layer) maps it to a status code; in-process
// callers handle it directly. Co-located with its only throwers (resolveCaller/requireOrigin).
export class SessionRequiredError extends Error {
  constructor(message = "Session handshake required") {
    super(message);
    this.name = "SessionRequiredError";
  }
}

type SessionRecord = {
  sessionId: string;
  actor: Actor | undefined;
  // The actor's full keypair (derived at hello). Retained for the session so daemon-side operations
  // can act AS this actor — `createWorkspace` signs the membership root, and `RegisterSync` captures
  // it so the sync tick keeps signing after the client disconnects. undefined only for an unverified
  // session (which can't exist post-hello). Local-first: this is the user's own process holding the
  // user's own key, not a third-party trust boundary.
  keypair: ActorKeypair | undefined;
  connectedAt: bigint;
  client: ClientInfo | undefined;
};

/**
 * The identity/auth half of the old SessionManager: the per-connection session store keyed by
 * connectionId. Owns session creation, the auth gate (resolveCaller/requireOrigin — the dispatch
 * boundary's chokepoint), and the actor-key retrieval daemon-side ops use to act as a session's
 * actor. Pure bookkeeping — no notification/subscription state (that's NotificationManager).
 */
export class SessionIdentity {
  private readonly sessionsByConnection = new Map<string, SessionRecord>();

  constructor(private readonly originLabel: string) {}

  createSession(
    connectionId: string,
    request: SessionHelloRequest,
    keypair?: ActorKeypair,
  ): SessionInfo {
    // The actor identity is derived from the mnemonic (no declared actor in the request) — it lives
    // on the keypair. An anonymous session (no keypair) has no actor.
    const actor =
      keypair === undefined ? undefined : create(ActorSchema, { actorId: keypair.actorId });
    const record: SessionRecord = {
      sessionId: randomUUID(),
      actor,
      keypair,
      connectedAt: BigInt(Date.now()),
      client: request.client,
    };
    this.sessionsByConnection.set(connectionId, record);
    return create(SessionInfoSchema, {
      sessionId: record.sessionId,
      actor: record.actor,
      connectedAt: record.connectedAt,
      ...(record.client === undefined ? {} : { client: record.client }),
    });
  }

  requireOrigin(connectionId: string): EngineOrigin {
    const record = this.sessionsByConnection.get(connectionId);
    if (record === undefined) {
      throw new SessionRequiredError();
    }
    const actor = record.actor;
    if (actor === undefined) {
      throw new SessionRequiredError();
    }
    return { nodeId: this.originLabel, actorId: actor.actorId, sessionId: record.sessionId };
  }

  /** The session actor's id + Ed25519 sign pub — what a peer needs to add this actor as a member.
   *  Throws SessionRequiredError without a verified session, so it doubles as the auth gate. */
  getActorPublicKeys(connectionId: string): { actorId: string; signPub: Uint8Array } {
    const record = this.sessionsByConnection.get(connectionId);
    if (record === undefined || record.actor === undefined || record.keypair === undefined) {
      throw new SessionRequiredError();
    }
    return { actorId: record.actor.actorId, signPub: record.keypair.publicKey };
  }

  /** The session actor's full keypair — for daemon-side operations that act AS this actor
   *  (`RegisterSync` captures it for the tick). Same SessionRequiredError gate. */
  getActorKeypair(connectionId: string): { actorId: string; keypair: ActorKeypair } {
    const record = this.sessionsByConnection.get(connectionId);
    if (record === undefined || record.actor === undefined || record.keypair === undefined) {
      throw new SessionRequiredError();
    }
    return { actorId: record.actor.actorId, keypair: record.keypair };
  }

  /** Resolve the caller for an authenticated RPC — the origin (change attribution) + the actor's
   *  keypair (signing). The single auth gate at the dispatch boundary (wrapCommands); throws
   *  SessionRequiredError without a verified session. Merges requireOrigin + getActorKeypair into one
   *  lookup. */
  resolveCaller(connectionId: string): ResolvedCaller {
    const record = this.sessionsByConnection.get(connectionId);
    if (record === undefined || record.actor === undefined || record.keypair === undefined) {
      throw new SessionRequiredError();
    }
    return {
      origin: {
        nodeId: this.originLabel,
        actorId: record.actor.actorId,
        sessionId: record.sessionId,
      },
      keypair: record.keypair,
    };
  }

  /** Drop the session record for a closed connection (the notification half closes its stream
   *  separately). */
  removeConnection(connectionId: string): void {
    this.sessionsByConnection.delete(connectionId);
  }

  /** Lifecycle teardown: drop all session bookkeeping. */
  close(): void {
    this.sessionsByConnection.clear();
  }
}
