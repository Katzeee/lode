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
import { authed, open } from "./handler.js";
import { DocNotFoundError } from "../errors/index.js";
import type { NotificationManager } from "../runtime/notification/notification-manager.js";
import { EMPTY } from "./wire/empty.js";
import type { WorkspaceRegistry } from "../runtime/workspace/registry.js";
import type { SessionIdentity } from "../runtime/identity/session-identity.js";
import { deriveActorKeypair, mintActorIdentity } from "../runtime/identity/identity-policy.js";

// The RPCs that are NOT domain adapters — session/identity (hello, mint, getActorPublicKeys) +
// notification (subscribe/unsubscribe/listen). They reach the identity store + the notification
// manager directly (runtime-resident), so they live alongside the domain handlers in commands/ and
// take the concrete subsystems as parameters. Each handler declares its own auth contract:
// hello/mint/listen are `open` (no session — hello CREATES it, mint is bootstrap, listen is the
// pre-auth stream); getActorPublicKeys/subscribe/unsubscribe are `authed`.

/** Resolve the engine for `workspaceId` or throw (the existence check subscribeDoc needs). */
async function requireEngine(workspaces: WorkspaceRegistry, workspaceId: string) {
  const engine = await workspaces.getEngine(workspaceId);
  if (!engine) {
    throw new DocNotFoundError(workspaceId);
  }
  return engine;
}

export function createSessionRpcs(
  identity: SessionIdentity,
  notify: NotificationManager,
  workspaces: WorkspaceRegistry,
) {
  return {
    // The client sends only the mnemonic; the identity policy derives the keypair. A bad/undecodable
    // mnemonic → AuthenticationError; the session is never created. Open (it CREATES the session).
    sessionHello: open((req: SessionHelloRequest, connectionId: string): SessionInfo => {
      const keypair = deriveActorKeypair(req.mnemonic);
      return identity.createSession(connectionId, req, keypair);
    }),

    // Mint a fresh actor identity — a 12-word mnemonic + the actor id it derives to. Open by design:
    // the bootstrap (`lode actor new`) a new user calls once, before any authed command.
    generateActorMnemonic: open((_req: Empty): ActorMnemonic => {
      const { mnemonic, actorId } = mintActorIdentity();
      return create(ActorMnemonicSchema, { mnemonic, actorId });
    }),

    // The caller's public identity — what a peer needs to add this actor as a sync member. Authed;
    // the sign pub comes from the caller's keypair.
    getActorPublicKeys: authed((_req: Empty, caller): ActorPublicKeys =>
      create(ActorPublicKeysSchema, {
        actorId: caller.origin.actorId,
        signPub: caller.keypair.publicKey,
      }),
    ),

    subscribeDoc: authed(async (req: SubscribeDocRequest, _caller, connectionId: string) => {
      await requireEngine(workspaces, req.workspaceId);
      notify.subscribeDoc(connectionId, req.workspaceId);
      return EMPTY;
    }),

    unsubscribeDoc: authed((req: UnsubscribeDocRequest, _caller, connectionId: string) => {
      notify.unsubscribeDoc(connectionId, req.workspaceId);
      return EMPTY;
    }),

    // The per-connection notification stream; the host (Connect) streams it to the client. Open it
    // before subscribing to receive notifications.
    listenNotifications: open(
      (_req: ListenNotificationsRequest, connectionId: string): AsyncIterable<Notification> =>
        notify.getOrCreateStream(connectionId),
    ),
  };
}

/** The session/notification/identity RPCs — merged with the domain commands before auth-wrapping. */
export type SessionRpcs = ReturnType<typeof createSessionRpcs>;
