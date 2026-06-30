import type {
  ListenNotificationsRequest,
  Notification,
  SessionHelloRequest,
  SessionInfo,
  SubscribeDocRequest,
  UnsubscribeDocRequest,
} from "@lode/protocol/proto";
import { deriveActorKeypairFromMnemonic } from "../utils/crypto/index.js";
import { getEngine, type AppContext } from "./context.js";
import { EMPTY } from "./empty.js";

export function createSessionHandlers(ctx: AppContext) {
  return {
    // The client sends the actor's mnemonic; the daemon derives the keypair and confirms the derived
    // actor id matches the declared one (only the mnemonic holder can). No match → reject; the session
    // is never created for an unverified actor.
    sessionHello: (req: SessionHelloRequest, connectionId: string): SessionInfo => {
      const actor = req.actor;
      let derivedActorId: string | undefined;
      try {
        derivedActorId = deriveActorKeypairFromMnemonic(req.mnemonic).actorId;
      } catch {
        derivedActorId = undefined;
      }
      if (actor === undefined || derivedActorId !== actor.actorId) {
        throw new Error("sessionHello: actor authentication failed (bad mnemonic)");
      }
      return ctx.sessions.createSession(connectionId, req);
    },

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
