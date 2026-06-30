import { randomUUID } from "node:crypto";
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

  constructor(private readonly nodeId: string) {}

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
