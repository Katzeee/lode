import { create } from "@bufbuild/protobuf";
import {
  NotificationSchema,
  OriginSchema,
  type NodeUpdatedPayload as ProtoNodeUpdatedPayload,
} from "@lode/protocol/proto";
import { NotificationStream, type NotificationHub } from "../../event.js";
import type { EngineOrigin } from "../../caller.js";

/**
 * The notification pub/sub half of the old SessionManager: per-workspace subscribers + per-connection
 * streams. Implements the NotificationHub port services + the workspace registry consume. Pure
 * delivery — no session/auth state (that's SessionIdentity). Shares only the connectionId key with
 * SessionIdentity.
 */
export class NotificationManager implements NotificationHub {
  // One doc per workspace, so subscriptions are keyed by workspaceId alone.
  private readonly subscribers = new Map<string, Set<string>>();
  private readonly streams = new Map<string, NotificationStream>();

  subscribeDoc(connectionId: string, workspaceId: string): void {
    subscribersFor(this.subscribers, workspaceId).add(connectionId);
  }

  unsubscribeDoc(connectionId: string, workspaceId: string): void {
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

  /** Close the stream for a closed connection + remove it from every workspace's subscriber set
   *  (the identity half drops the session record separately). */
  removeConnection(connectionId: string): void {
    this.streams.get(connectionId)?.close();
    this.streams.delete(connectionId);
    for (const subs of this.subscribers.values()) {
      subs.delete(connectionId);
    }
  }

  /** Drop the subscriber set for `wsId` — called from the workspace death point so a removed
   *  workspace leaves no stale subscribers (a same-id rebuild would otherwise broadcast to the old
   *  connections). Connection streams are per-connection, not per-workspace, so they stay. */
  purgeWorkspace(workspaceId: string): void {
    this.subscribers.delete(workspaceId);
  }

  /** Lifecycle teardown: complete every open notification stream and drop the subscriber/ stream
   *  bookkeeping. The runtime roots this on the App (via a Component adapter) so `app.stop()` reaches
   *  it regardless of how the host wired connection teardown. */
  close(): void {
    for (const stream of this.streams.values()) {
      stream.close();
    }
    this.streams.clear();
    this.subscribers.clear();
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
