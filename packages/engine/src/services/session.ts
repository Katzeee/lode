import type {
  ListenNotificationsRequest,
  Notification,
  SessionHelloRequest,
  SessionInfo,
  SubscribeDocRequest,
  UnsubscribeDocRequest,
} from "@lode/protocol/proto";
import { getEngine, type AppContext } from "./context.js";
import { EMPTY } from "./empty.js";

export function createSessionHandlers(ctx: AppContext) {
  return {
    sessionHello: (req: SessionHelloRequest, connectionId: string): SessionInfo =>
      ctx.sessions.createSession(connectionId, req),

    subscribeDoc: async (req: SubscribeDocRequest, connectionId: string) => {
      ctx.sessions.requireOrigin(connectionId);
      await getEngine(ctx, req.workspaceId);
      ctx.sessions.subscribeDoc(connectionId, req.workspaceId);
      return EMPTY;
    },

    unsubscribeDoc: (req: UnsubscribeDocRequest, connectionId: string) => {
      ctx.sessions.unsubscribeDoc(connectionId, req.workspaceId);
      return EMPTY;
    },

    // Returns the per-connection notification stream; the host (Connect) streams it to the
    // client. The client must open this before subscribing to receive notifications.
    listenNotifications: (
      _req: ListenNotificationsRequest,
      connectionId: string,
    ): AsyncIterable<Notification> => ctx.sessions.getOrCreateStream(connectionId),
  };
}
