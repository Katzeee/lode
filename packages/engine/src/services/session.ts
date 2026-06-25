import type {
  ListenNotificationsRequest,
  Notification,
  SessionHelloRequest,
  SessionInfo,
  SubscribeDocRequest,
  UnsubscribeDocRequest,
} from "@lode/protocol/proto";
import { getDoc, type AppContext } from "./context.js";
import { EMPTY } from "./empty.js";

export function createSessionHandlers(ctx: AppContext) {
  return {
    sessionHello: (req: SessionHelloRequest, connectionId: string): SessionInfo =>
      ctx.sessions.createSession(connectionId, req),

    subscribeDoc: async (req: SubscribeDocRequest, connectionId: string) => {
      ctx.sessions.requireOrigin(connectionId);
      await getDoc(ctx, req.workspaceId, req.docId);
      ctx.sessions.subscribeDoc(connectionId, req.workspaceId, req.docId);
      return EMPTY;
    },

    unsubscribeDoc: (req: UnsubscribeDocRequest, connectionId: string) => {
      ctx.sessions.unsubscribeDoc(connectionId, req.workspaceId, req.docId);
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
