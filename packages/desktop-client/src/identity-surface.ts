import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import {
  AdmitActorRequestSchema,
  AdmitPeerRequestSchema,
  CreateActorRequestSchema,
  GovernanceSummaryRequestSchema,
  ImportActorRequestSchema,
  RemoveActorRequestSchema,
  RevokePeerRequestSchema,
  RotateTransitRequestSchema,
  TransferOwnerRequestSchema,
  UnlockVaultRequestSchema,
  type ActorSummary,
  type GovernanceSummary,
  type HomePeerMaterial,
} from "@lode/protocol/proto";
import type { Client } from "@connectrpc/connect";
import type { IdentityService, WorkspaceGovernanceService } from "@lode/protocol/proto";

/** The identity and governance client surfaces: one authenticated bundle each. */
export type SurfaceClients = Readonly<{
  identity: Client<typeof IdentityService>;
  governance: Client<typeof WorkspaceGovernanceService>;
}>;

export function createIdentitySurface(
  clients: SurfaceClients,
  headers: () => Headers,
): Readonly<{
  listActors(): Promise<Readonly<{ vaultExists: boolean; actors: readonly ActorSummary[] }>>;
  createActor(
    input: Readonly<{ label: string; passphrase: string }>,
  ): Promise<Readonly<{ actorId: string; recoveryPhrase: string }>>;
  importActor(
    input: Readonly<{ recoveryPhrase: string; passphrase: string; label: string }>,
  ): Promise<Readonly<{ actorId: string }>>;
  unlockVault(passphrase: string): Promise<Readonly<{ vaultExists: boolean; actors: readonly ActorSummary[] }>>;
  lockVault(): Promise<void>;
  peerMaterial(): Promise<HomePeerMaterial>;
}> {
  return {
    listActors: () => clients.identity.listActors(create(EmptySchema), { headers: headers() }),
    createActor: (input) =>
      clients.identity.createActor(create(CreateActorRequestSchema, input), { headers: headers() }),
    importActor: (input) =>
      clients.identity.importActor(create(ImportActorRequestSchema, input), { headers: headers() }),
    unlockVault: (passphrase) =>
      clients.identity.unlockVault(create(UnlockVaultRequestSchema, { passphrase }), { headers: headers() }),
    lockVault: async () => {
      await clients.identity.lockVault(create(EmptySchema), { headers: headers() });
    },
    peerMaterial: () => clients.identity.peerMaterial(create(EmptySchema), { headers: headers() }),
  };
}

export function createGovernanceSurface(
  clients: SurfaceClients,
  headers: () => Headers,
): Readonly<{
  governanceSummary(workspaceId: string): Promise<GovernanceSummary>;
  admitActor(
    input: Readonly<{ workspaceId: string; actingActorId: string; actorId: string; requestId?: string }>,
  ): Promise<void>;
  removeActor(
    input: Readonly<{ workspaceId: string; actingActorId: string; actorId: string; requestId?: string }>,
  ): Promise<void>;
  transferOwner(
    input: Readonly<{ workspaceId: string; actingActorId: string; nextOwnerActorId: string; requestId?: string }>,
  ): Promise<void>;
  admitPeer(
    input: Readonly<{
      workspaceId: string;
      actingActorId: string;
      peerId: string;
      peerKxPublicKey: string;
      requestId?: string;
    }>,
  ): Promise<void>;
  revokePeer(
    input: Readonly<{ workspaceId: string; actingActorId: string; peerId: string; requestId?: string }>,
  ): Promise<void>;
  rotateTransit(input: Readonly<{ workspaceId: string; actingActorId: string; requestId?: string }>): Promise<void>;
}> {
  return {
    governanceSummary: (workspaceId) =>
      clients.governance.summary(create(GovernanceSummaryRequestSchema, { workspaceId }), { headers: headers() }),
    admitActor: async (input) => {
      await clients.governance.admitActor(
        create(AdmitActorRequestSchema, { ...input, requestId: input.requestId ?? undefined }),
        { headers: headers() },
      );
    },
    removeActor: async (input) => {
      await clients.governance.removeActor(
        create(RemoveActorRequestSchema, { ...input, requestId: input.requestId ?? undefined }),
        { headers: headers() },
      );
    },
    transferOwner: async (input) => {
      await clients.governance.transferOwner(
        create(TransferOwnerRequestSchema, { ...input, requestId: input.requestId ?? undefined }),
        { headers: headers() },
      );
    },
    admitPeer: async (input) => {
      await clients.governance.admitPeer(
        create(AdmitPeerRequestSchema, { ...input, requestId: input.requestId ?? undefined }),
        { headers: headers() },
      );
    },
    revokePeer: async (input) => {
      await clients.governance.revokePeer(
        create(RevokePeerRequestSchema, { ...input, requestId: input.requestId ?? undefined }),
        { headers: headers() },
      );
    },
    rotateTransit: async (input) => {
      await clients.governance.rotateTransit(
        create(RotateTransitRequestSchema, { ...input, requestId: input.requestId ?? undefined }),
        { headers: headers() },
      );
    },
  };
}
