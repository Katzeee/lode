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
} from "@lode/protocol/proto";
import type { Client } from "@connectrpc/connect";
import type { IdentityService, WorkspaceGovernanceService } from "@lode/protocol/proto";
import type { EngineGovernance, EngineIdentity } from "@lode/sdk/host";

/** The identity and governance client surfaces: one authenticated bundle each. */
export type SurfaceClients = Readonly<{
  identity: Client<typeof IdentityService>;
  governance: Client<typeof WorkspaceGovernanceService>;
}>;

export type DesktopGovernanceSurface = Omit<EngineGovernance, "summary"> &
  Readonly<{ governanceSummary: EngineGovernance["summary"] }>;

export function createIdentitySurface(clients: SurfaceClients, headers: () => Headers): EngineIdentity {
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

export function createGovernanceSurface(clients: SurfaceClients, headers: () => Headers): DesktopGovernanceSurface {
  return {
    governanceSummary: async (workspaceId) => {
      const summary = await clients.governance.summary(create(GovernanceSummaryRequestSchema, { workspaceId }), {
        headers: headers(),
      });
      return {
        established: summary.established,
        ownerActorId: summary.ownerActorId ?? null,
        memberActorIds: summary.memberActorIds,
        epoch: summary.epoch,
        peers: summary.peers,
      };
    },
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
