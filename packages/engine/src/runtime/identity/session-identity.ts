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
import type { ResolvedCaller } from "./caller.js";
import type { ActorKeypair } from "../../crypto/index.js";
import type { Component } from "../lifecycle.js";

// Engine-internal typed error: the daemon (Connect layer) maps it to a status code; in-process
// callers handle it directly. Co-located with its only thrower (resolveCaller).
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
 * connectionId. Owns session creation + the auth gate (resolveCaller — the dispatch boundary's
 * single chokepoint). Pure bookkeeping — no notification/subscription state (that's
 * NotificationManager).
 */
export class SessionIdentity implements Component {
  /** Component name — registers itself on the Lifecycle (see createEngineRuntime). */
  readonly name = "session-identity";

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

  /** Resolve the caller for an authenticated RPC — the origin (change attribution) + the actor's
   *  keypair (signing). The single auth gate at the dispatch boundary (wrapCommands); throws
   *  SessionRequiredError without a verified session. The ONE lookup `authed` handlers need: it
   *  returns both the change origin and the signing keypair. */
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

  /** Component lifecycle: drop all session bookkeeping. */
  stop(): void {
    this.close();
  }

  /** Lifecycle teardown (also the Component.stop body): drop all session bookkeeping. */
  close(): void {
    this.sessionsByConnection.clear();
  }
}
