import { randomBytes, randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import {
  NotificationSchema,
  OriginSchema,
  SessionInfoSchema,
  type Actor,
  type ClientInfo,
  type NodeUpdatedPayload as ProtoNodeUpdatedPayload,
  type SessionHelloRequest,
  type SessionInfo,
} from "@lode/protocol/proto";
import { NotificationStream } from "../event/notification-stream.js";

// Engine-internal typed error: the daemon (Connect layer) maps it to a status code; in-process
// callers handle it directly. Co-located with its only thrower (requireOrigin) because session/
// sits below services/ in the layer DAG.
export class SessionRequiredError extends Error {
  constructor(message = "Session handshake required") {
    super(message);
    this.name = "SessionRequiredError";
  }
}

export type EngineOrigin = {
  nodeId: string;
  actorId: string;
  sessionId: string;
};

type SessionRecord = {
  sessionId: string;
  actor: Actor | undefined;
  connectedAt: bigint;
  client: ClientInfo | undefined;
};

export class SessionManager {
  private readonly sessionsByConnection = new Map<string, SessionRecord>();
  // One doc per workspace, so subscriptions are keyed by workspaceId alone.
  private readonly subscribers = new Map<string, Set<string>>();
  private readonly streams = new Map<string, NotificationStream>();
  // F4 challenge-response: a pending per-connection nonce, single-use + short TTL. Crypto-free — the
  // signature verification happens in the services adapter (`services/session.ts`), which may import
  // identity; this layer only owns nonce lifecycle.
  private readonly challenges = new Map<string, { nonce: Uint8Array; expiresAt: number }>();

  private static readonly CHALLENGE_TTL_MS = 60_000;

  constructor(private readonly nodeId: string) {}

  /** F4: issue a fresh challenge nonce for this connection (single-use, TTL-bounded). */
  issueChallenge(connectionId: string): Uint8Array {
    const nonce = randomBytes(32);
    this.challenges.set(connectionId, {
      nonce,
      expiresAt: Date.now() + SessionManager.CHALLENGE_TTL_MS,
    });
    return nonce;
  }

  /** F4: consume the challenge for this connection. True only if `nonce` matches a fresh, unused,
   *  unexpired challenge — and the challenge is revoked (single-use) on success. */
  consumeChallenge(connectionId: string, nonce: Uint8Array): boolean {
    const pending = this.challenges.get(connectionId);
    if (pending === undefined) {
      return false; // no challenge issued (or already consumed)
    }
    this.challenges.delete(connectionId); // single-use: revoke whether or not it matches
    if (Date.now() > pending.expiresAt) {
      return false; // expired
    }
    return Buffer.from(nonce).equals(Buffer.from(pending.nonce));
  }

  createSession(connectionId: string, request: SessionHelloRequest): SessionInfo {
    const record: SessionRecord = {
      sessionId: randomUUID(),
      actor: request.actor,
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
    return { nodeId: this.nodeId, actorId: actor.actorId, sessionId: record.sessionId };
  }

  subscribeDoc(connectionId: string, workspaceId: string): void {
    this.requireOrigin(connectionId);
    subscribersFor(this.subscribers, workspaceId).add(connectionId);
  }

  unsubscribeDoc(connectionId: string, workspaceId: string): void {
    this.requireOrigin(connectionId);
    this.subscribers.get(workspaceId)?.delete(connectionId);
  }

  // The ListenNotifications handler drains this as an async iterable. Created lazily;
  // broadcasts to a connection with no open stream are dropped (the client must open
  // the stream before subscribing).
  getOrCreateStream(connectionId: string): NotificationStream {
    let stream = this.streams.get(connectionId);
    if (stream === undefined) {
      stream = new NotificationStream();
      this.streams.set(connectionId, stream);
    }
    return stream;
  }

  broadcastNodeUpdated(
    workspaceId: string,
    payloads: ProtoNodeUpdatedPayload[],
    origin: EngineOrigin,
  ): void {
    if (payloads.length === 0) {
      return;
    }
    const notification = create(NotificationSchema, {
      workspaceId,
      origin: create(OriginSchema, {
        nodeId: origin.nodeId,
        actorId: origin.actorId,
        sessionId: origin.sessionId,
      }),
      payloads,
    });
    const subs = this.subscribers.get(workspaceId);
    if (subs === undefined) {
      return;
    }
    for (const connectionId of subs) {
      this.streams.get(connectionId)?.push(notification);
    }
  }

  removeConnection(connectionId: string): void {
    this.sessionsByConnection.delete(connectionId);
    this.challenges.delete(connectionId);
    this.streams.get(connectionId)?.close();
    this.streams.delete(connectionId);
    for (const subs of this.subscribers.values()) {
      subs.delete(connectionId);
    }
  }
}

function subscribersFor(map: Map<string, Set<string>>, workspaceId: string): Set<string> {
  let subs = map.get(workspaceId);
  if (subs === undefined) {
    subs = new Set();
    map.set(workspaceId, subs);
  }
  return subs;
}
