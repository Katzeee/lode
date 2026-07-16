import { create } from "@bufbuild/protobuf";
import type { Empty } from "@bufbuild/protobuf/wkt";
import {
  type ActorPublicKeys,
  type ListenNotificationsRequest,
  type Notification,
  type SessionHelloRequest,
  type SessionInfo,
  type SubscribeDocRequest,
  type UnsubscribeDocRequest,
} from "@lode/protocol/proto";
import { ActorPublicKeysSchema } from "@lode/protocol/proto";
import { authed, open } from "./handler.js";
import { EMPTY } from "./wire/empty.js";
import type { WorkspaceRegistry } from "../runtime/workspace/registry.js";
import type { ClientSessionManager } from "../runtime/session/client-session-manager.js";
import { deriveActorKeypair } from "../runtime/identity/identity-policy.js";

// The session/notification/identity RPCs — NOT domain adapters, NOT vault. They reach the session
// manager + notification pump + identity policy directly (runtime-resident), so they live in commands/
// and take the concrete subsystems as parameters. (The vault RPCs live in vault-rpcs.ts.) Each handler
// declares its own auth contract: hello/listen are `open` (hello CREATES the session, listen is the
// pre-auth stream); getActorPublicKeys/subscribe/unsubscribe are `authed`.

export function createSessionRpcs(sessions: ClientSessionManager, workspaces: WorkspaceRegistry) {
  return {
    // The client sends only the mnemonic; the identity policy derives the keypair. A bad/undecodable
    // mnemonic → AuthenticationError; the session is never created. Open (it CREATES the session).
    sessionHello: open(
      async (req: SessionHelloRequest, connectionId: string): Promise<SessionInfo> => {
        const keypair = deriveActorKeypair(req.mnemonic);
        return sessions.createSession(connectionId, req, keypair);
      },
    ),

    // The caller's public identity — what a peer needs to add this actor as a sync member. Authed;
    // the sign pub comes from the caller's keypair.
    getActorPublicKeys: authed((_req: Empty, caller): ActorPublicKeys =>
      create(ActorPublicKeysSchema, {
        actorId: caller.origin.actorId,
        signPub: caller.keypair.publicKey,
      }),
    ),

    subscribeDoc: authed(async (req: SubscribeDocRequest, _caller, connectionId: string) => {
      await workspaces.runWorkspace(req.workspaceId, ({ instance, facts }) => {
        return sessions.subscribeWorkspace(connectionId, req.workspaceId, instance, facts);
      });
      return EMPTY;
    }),

    unsubscribeDoc: authed((req: UnsubscribeDocRequest, _caller, connectionId: string) => {
      sessions.unsubscribeWorkspace(connectionId, req.workspaceId);
      return EMPTY;
    }),

    // The per-connection notification stream; the host (Connect) streams it to the client. Open it
    // before subscribing to receive notifications.
    listenNotifications: open(
      (_req: ListenNotificationsRequest, connectionId: string): AsyncIterable<Notification> =>
        sessions.listenNotifications(connectionId),
    ),
  };
}

/** The session/notification/identity RPCs — merged with the domain commands + vault RPCs before
 *  auth-wrapping. */
export type SessionRpcs = ReturnType<typeof createSessionRpcs>;
