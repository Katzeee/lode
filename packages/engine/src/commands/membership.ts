import { create } from "@bufbuild/protobuf";
import type { Empty } from "@bufbuild/protobuf/wkt";
import type {
  AddMemberRequest,
  AddPeerRequest,
  GetPeerPublicKeysResponse,
  ListMembersRequest,
  ListMembersResponse,
  RevokePeerRequest,
  RotateTransitRequest,
  TransferOwnerRequest,
} from "@lode/protocol/proto";
import {
  GetPeerPublicKeysResponseSchema,
  ListedPeerSchema,
  ListMembersResponseSchema,
} from "@lode/protocol/proto";
import { authed } from "./handler.js";
import type { CommandDeps } from "./wire/context.js";
import { EMPTY } from "./wire/empty.js";
import { DomainInvalidInputError } from "../domain/errors.js";
import type { MembershipLog } from "../runtime/membership/membership-log.js";

function readMembership<T>(
  ctx: CommandDeps,
  workspaceId: string,
  operation: (log: MembershipLog) => T | Promise<T>,
): Promise<T> {
  return ctx.workspaces.runWorkspace(workspaceId, ({ membership }) => operation(membership));
}

function mutateMembership<T>(
  ctx: CommandDeps,
  workspaceId: string,
  operation: (log: MembershipLog) => T | Promise<T>,
): Promise<T> {
  return ctx.workspaces.runWorkspaceExclusive(workspaceId, ({ membership }) =>
    operation(membership),
  );
}

/** Membership / peer-governance RPC handlers — relay-independent adapters over the engine's
 *  membership log (design sync-identity-persistence §2 + §13). They live in the ENGINE (not the
 *  daemon) because they reach only the workspace registry, never the sync service — so an in-process
 *  consumer (mobile/embedded) gets them too, with no daemon. The daemon merges these with its
 *  host-only sync handlers (share/join/register/syncNow, which DO need the runner) in
 *  connect-server.ts. All are authed (the boundary resolves the caller); the actor keypair comes from
 *  the caller (resolved from the session), never re-sent by the client. The domain logic + owner/
 *  self-service guards live in `MembershipLog`; these are thin adapters: fetch the log → call the
 *  engine method → persist. */
export function createMembershipHandlers(ctx: CommandDeps) {
  return {
    // Owner-only governance: add a member to the workspace's membership log. The owner unwraps the
    // current transit via its OWN peer, then re-wraps it to the joiner's peer. The owner guard lives
    // in MembershipLog.addMember.
    addMember: authed(async (req: AddMemberRequest, caller): Promise<Empty> => {
      await mutateMembership(ctx, req.workspaceId, async (log) => {
        log.addMember(ctx.workspaces.localPeerFor(caller.keypair), {
          peerId: req.peerId,
          owningActorId: req.owningActorId,
          peerEncPub: req.peerEncPub,
          peerName: req.peerName ?? "",
        });
        await log.persistIfDirty();
      });
      return EMPTY;
    }),
    // Read-only roster: project the replayed membership state — peers (flat: peerId + peer_name +
    // owning actor) + owner + epoch. Backs `lode member list` (the CLI groups by actor, owner flagged).
    listMembers: authed((req: ListMembersRequest, _caller): Promise<ListMembersResponse> =>
      readMembership(ctx, req.workspaceId, (log) => {
        const { state } = log.deriveState();
        return create(ListMembersResponseSchema, {
          owner: state.owner,
          epoch: state.currentEpoch,
          peers: [...state.peers.entries()].map(([peerId, peer]) =>
            create(ListedPeerSchema, {
              peerId,
              peerName: peer.peerName,
              owningActorId: peer.owningActorId,
            }),
          ),
        });
      }),
    ),
    // Owner-only: revoke one peer (peer_id) or every peer of an actor (actor_id). Atomic
    // removeAndRotate — the engine mints a fresh transit key the survivors unwrap. Owner guard +
    // the "keep ≥1 owner peer" invariant live in MembershipLog. Identifiers are trimmed; exactly one
    // of peer_id/actor_id is required.
    revokePeer: authed(async (req: RevokePeerRequest, caller): Promise<Empty> => {
      const local = ctx.workspaces.localPeerFor(caller.keypair);
      const peerId = req.peerId?.trim();
      const actorId = req.actorId?.trim();
      if (peerId !== undefined && peerId !== "") {
        if (actorId !== undefined && actorId !== "") {
          throw new DomainInvalidInputError(
            "revokePeer: set exactly one of peer_id or actor_id (both provided)",
          );
        }
        await mutateMembership(ctx, req.workspaceId, async (log) => {
          log.revokePeer(local, peerId);
          await log.persistIfDirty();
        });
      } else if (actorId !== undefined && actorId !== "") {
        await mutateMembership(ctx, req.workspaceId, async (log) => {
          log.revokeActor(local, actorId);
          await log.persistIfDirty();
        });
      } else {
        throw new DomainInvalidInputError(
          "revokePeer: set exactly one of peer_id or actor_id (neither provided)",
        );
      }
      return EMPTY;
    }),
    // Self-service: an actor adds their OWN further peer (the new peer exported an identity token; the
    // actor pastes it from an ADMITTED peer). The token's actorId (`owning_actor_id`) MUST equal the
    // caller's actor — a token from a different actor is rejected (no cross-actor adoption). The
    // replay's self-service rule authorizes (signer == owningActor AND owns ≥1 peer).
    addPeer: authed(async (req: AddPeerRequest, caller): Promise<Empty> => {
      const local = ctx.workspaces.localPeerFor(caller.keypair);
      if (req.owningActorId !== local.actor.actorId) {
        throw new DomainInvalidInputError("addPeer: identity token belongs to a different actor");
      }
      await mutateMembership(ctx, req.workspaceId, async (log) => {
        log.addSelfPeer(local, {
          peerId: req.peerId,
          owningActorId: local.actor.actorId,
          peerEncPub: req.peerEncPub,
          peerName: req.peerName,
        });
        await log.persistIfDirty();
      });
      return EMPTY;
    }),
    // Owner-only: transfer governance to an existing member actor (must own ≥1 peer, must not be the
    // current owner). The engine validates the target and throws a clear error; the replay re-enforces.
    transferOwner: authed(async (req: TransferOwnerRequest, caller): Promise<Empty> => {
      await mutateMembership(ctx, req.workspaceId, async (log) => {
        log.transferOwnership(ctx.workspaces.localPeerFor(caller.keypair), req.newOwnerActorId);
        await log.persistIfDirty();
      });
      return EMPTY;
    }),
    // Owner-only: manually re-key the workspace (forward-secrecy rotation; same roster). No one is
    // revoked; every peer gets the new transit key re-wrapped to them.
    rotateTransit: authed(async (req: RotateTransitRequest, caller): Promise<Empty> => {
      await mutateMembership(ctx, req.workspaceId, async (log) => {
        log.rotateTransit(ctx.workspaces.localPeerFor(caller.keypair));
        await log.persistIfDirty();
      });
      return EMPTY;
    }),
    // This caller's local peer identity — the tuple (peerId + X25519 enc pub + owning actor) a joiner
    // hands to an owner out-of-band so the owner can `addMember` it. Sibling of getActorPublicKeys
    // (session-rpcs.ts): that returns the actor's sign pub, this returns the peer's X25519 enc
    // pub — the two identity layers (§13).
    getPeerPublicKeys: authed((_req: Empty, caller): GetPeerPublicKeysResponse => {
      const local = ctx.workspaces.localPeerFor(caller.keypair);
      return create(GetPeerPublicKeysResponseSchema, {
        peerId: local.peerId,
        peerEncPub: local.peer.publicKey,
        owningActorId: local.actor.actorId,
      });
    }),
  };
}
