import { create } from "@bufbuild/protobuf";
import type { Empty } from "@bufbuild/protobuf/wkt";
import type {
  ActorMnemonic,
  ActorPublicKeys,
  ListenNotificationsRequest,
  Notification,
  SessionHelloRequest,
  SessionInfo,
  SubscribeDocRequest,
  UnsubscribeDocRequest,
} from "@lode/protocol/proto";
import { ActorMnemonicSchema, ActorPublicKeysSchema } from "@lode/protocol/proto";
import { deriveActorKeypair, mintActorIdentity } from "../session/identity-policy.js";
import { getEngine, type AppContext } from "./context.js";
import { EMPTY } from "./empty.js";

export function createSessionHandlers(ctx: AppContext) {
  return {
    // The client sends only the mnemonic; the identity policy derives the keypair (the identity IS
    // the derived actor id — no declared actor to cross-check). A bad/undecodable mnemonic → the
    // policy throws AuthenticationError; the session is never created. The derived sign pub is
    // retained on the session so a peer can add this actor as a member via GetActorPublicKeys.
    sessionHello: (req: SessionHelloRequest, connectionId: string): SessionInfo => {
      const keypair = deriveActorKeypair(req.mnemonic);
      return ctx.sessions.createSession(connectionId, req, keypair);
    },

    // Mint a fresh actor identity — a 12-word mnemonic + the actor id it derives to. Unauthenticated
    // by design: this is the bootstrap (`lode actor new`) a new user calls once, before any authed
    // command is possible. The policy mints a new identity; it reads/signs nothing.
    generateActorMnemonic: (_req: Empty): ActorMnemonic => {
      const { mnemonic, actorId } = mintActorIdentity();
      return create(ActorMnemonicSchema, { mnemonic, actorId });
    },

    // The session actor's public identity — what a peer needs to add this actor as a sync member.
    // Gated (throws without a verified session).
    getActorPublicKeys: (_req: Empty, connectionId: string): ActorPublicKeys => {
      const { actorId, signPub } = ctx.sessions.getActorPublicKeys(connectionId);
      return create(ActorPublicKeysSchema, { actorId, signPub });
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
