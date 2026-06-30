import { create } from "@bufbuild/protobuf";
import {
  SessionChallengeResponseSchema,
  type ListenNotificationsRequest,
  type Notification,
  type SessionChallengeResponse,
  type SessionHelloRequest,
  type SessionInfo,
  type SubscribeDocRequest,
  type UnsubscribeDocRequest,
} from "@lode/protocol/proto";
import { verifyActorSignature } from "../identity/actor-key.js";
import { actorIdFromPublicKey } from "../identity/actor-key.js";
import { getEngine, type AppContext } from "./context.js";
import { EMPTY } from "./empty.js";

export function createSessionHandlers(ctx: AppContext) {
  return {
    // F4: issue a per-connection challenge nonce the client must sign to prove it holds the actor's
    // private key (consumed + verified in sessionHello below).
    sessionChallenge: (_req: unknown, connectionId: string): SessionChallengeResponse =>
      create(SessionChallengeResponseSchema, {
        challenge: ctx.sessions.issueChallenge(connectionId),
      }),

    // F4: verify the actor proved ownership — the challenge was issued for this connection (single-use,
    // fresh) AND the signature verifies against the declared sign_pub. No proof → reject (throw → the
    // daemon maps the error to a status); the session is never created for an unverified actor.
    sessionHello: (req: SessionHelloRequest, connectionId: string): SessionInfo => {
      const signPub = req.actor?.signPub;
      const actorIdMatches =
        req.actor !== undefined &&
        signPub !== undefined &&
        req.actor.actorId === actorIdFromPublicKey(signPub);
      if (
        !signPub ||
        !actorIdMatches ||
        !ctx.sessions.consumeChallenge(connectionId, req.challenge) ||
        !verifyActorSignature(signPub, req.challenge, req.signature)
      ) {
        throw new Error("sessionHello: actor authentication failed (bad challenge or signature)");
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
