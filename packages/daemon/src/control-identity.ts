import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import {
  ActorListResultSchema,
  CreateActorResultSchema,
  GovernanceSummarySchema,
  HomePeerMaterialSchema,
  ImportActorResultSchema,
  type AdmitActorRequest,
  type AdmitPeerRequest,
  type CreateActorRequest,
  type GovernanceSummaryRequest,
  type ImportActorRequest,
  type RemoveActorRequest,
  type RevokePeerRequest,
  type RotateTransitRequest,
  type TransferOwnerRequest,
  type UnlockVaultRequest,
} from "@lode/protocol/proto";
import type { HandlerContext } from "@connectrpc/connect";
import type { Engine } from "@lode/sdk/host";

/**
 * The identity and governance halves of the local control plane: Actor vault
 * management and signed workspace governance, all behind the Home access
 * token that the shared unary wrapper applies.
 */

export type UnaryWrapper = <I, O>(
  handler: (request: I) => Promise<O> | O,
) => (request: I, context: HandlerContext) => Promise<O>;

export function identityRoutes(engine: Engine, unary: UnaryWrapper) {
  return {
    listActors: unary(async () => {
      const listed = await engine.identity.listActors();
      return create(ActorListResultSchema, {
        vaultExists: listed.vaultExists,
        actors: [...listed.actors],
      });
    }),
    createActor: unary(async (request: CreateActorRequest) => {
      const created = await engine.identity.createActor({
        label: request.label,
        passphrase: request.passphrase,
      });
      return create(CreateActorResultSchema, created);
    }),
    importActor: unary(async (request: ImportActorRequest) => {
      const imported = await engine.identity.importActor({
        recoveryPhrase: request.recoveryPhrase,
        passphrase: request.passphrase,
        label: request.label,
      });
      return create(ImportActorResultSchema, imported);
    }),
    unlockVault: unary(async (request: UnlockVaultRequest) => {
      const listed = await engine.identity.unlockVault(request.passphrase);
      return create(ActorListResultSchema, {
        vaultExists: listed.vaultExists,
        actors: [...listed.actors],
      });
    }),
    lockVault: unary(async () => {
      await engine.identity.lockVault();
      return create(EmptySchema);
    }),
    peerMaterial: unary(async () => {
      const material = await engine.identity.peerMaterial();
      return create(HomePeerMaterialSchema, { ...material, actorIds: [...material.actorIds] });
    }),
  };
}

export function governanceRoutes(engine: Engine, unary: UnaryWrapper) {
  return {
    summary: unary(async (request: GovernanceSummaryRequest) => {
      const summary = await engine.governance.summary(request.workspaceId);
      return create(GovernanceSummarySchema, {
        established: summary.established,
        ownerActorId: summary.ownerActorId ?? undefined,
        memberActorIds: [...summary.memberActorIds],
        epoch: summary.epoch,
        peers: summary.peers.map((peer) => ({ ...peer })),
      });
    }),
    admitActor: unary(async (request: AdmitActorRequest) => {
      await engine.governance.admitActor({
        workspaceId: request.workspaceId,
        actingActorId: request.actingActorId,
        actorId: request.actorId,
        requestId: request.requestId,
      });
      return create(EmptySchema);
    }),
    removeActor: unary(async (request: RemoveActorRequest) => {
      await engine.governance.removeActor({
        workspaceId: request.workspaceId,
        actingActorId: request.actingActorId,
        actorId: request.actorId,
        requestId: request.requestId,
      });
      return create(EmptySchema);
    }),
    transferOwner: unary(async (request: TransferOwnerRequest) => {
      await engine.governance.transferOwner({
        workspaceId: request.workspaceId,
        actingActorId: request.actingActorId,
        nextOwnerActorId: request.nextOwnerActorId,
        requestId: request.requestId,
      });
      return create(EmptySchema);
    }),
    admitPeer: unary(async (request: AdmitPeerRequest) => {
      await engine.governance.admitPeer({
        workspaceId: request.workspaceId,
        actingActorId: request.actingActorId,
        peerId: request.peerId,
        peerKxPublicKey: request.peerKxPublicKey,
        requestId: request.requestId,
      });
      return create(EmptySchema);
    }),
    revokePeer: unary(async (request: RevokePeerRequest) => {
      await engine.governance.revokePeer({
        workspaceId: request.workspaceId,
        actingActorId: request.actingActorId,
        peerId: request.peerId,
        requestId: request.requestId,
      });
      return create(EmptySchema);
    }),
    rotateTransit: unary(async (request: RotateTransitRequest) => {
      await engine.governance.rotateTransit({
        workspaceId: request.workspaceId,
        actingActorId: request.actingActorId,
        requestId: request.requestId,
      });
      return create(EmptySchema);
    }),
  };
}
