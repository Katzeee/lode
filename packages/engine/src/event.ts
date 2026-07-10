import type { Notification, NodeUpdatedPayload } from "@lode/protocol/proto";
import type { EngineOrigin } from "./caller.js";

// An unbounded async queue: the engine pushes proto Notifications (via the notification
// manager's broadcast), and the ListenNotifications handler drains it as an async iterable.
// One stream per connectionId. Pushing after close is a no-op so a closing connection stops
// receiving without racing the broadcast.
export class NotificationStream {
  private readonly queue: Notification[] = [];
  private readonly waiters: ((result: IteratorResult<Notification>) => void)[] = [];
  private closed = false;

  push(notification: Notification): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter({ value: notification, done: false });
    } else {
      this.queue.push(notification);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters) {
      waiter({ value: undefined, done: true });
    }
    this.waiters.length = 0;
  }

  [Symbol.asyncIterator](): AsyncIterator<Notification> {
    const next = (): Promise<IteratorResult<Notification>> => {
      const queued = this.queue.shift();
      if (queued !== undefined) {
        return Promise.resolve({ value: queued, done: false });
      }
      if (this.closed) {
        return Promise.resolve({ value: undefined, done: true });
      }
      return new Promise((resolve) => {
        this.waiters.push(resolve);
      });
    };
    return { next };
  }
}

/** The notification pub/sub surface services + the workspace registry consume (subscribe per
 *  connection, broadcast a change to a workspace's subscribers). Implemented by NotificationManager
 *  (runtime/notification); the port lets callers depend on the contract, not the impl. */
export type NotificationHub = {
  subscribeDoc(connectionId: string, workspaceId: string): void;
  unsubscribeDoc(connectionId: string, workspaceId: string): void;
  getOrCreateStream(connectionId: string): NotificationStream;
  broadcastNodeUpdated(
    workspaceId: string,
    payloads: NodeUpdatedPayload[],
    origin: EngineOrigin,
  ): void;
  /** Drop the subscriber set for a dead workspace (called from the workspace death funnel). */
  purgeWorkspace(workspaceId: string): void;
};
