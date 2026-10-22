import { create, type DescMessage, type MessageInitShape, type MessageShape } from "@bufbuild/protobuf";
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
type SurfaceClients = Readonly<{
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
    admitActor: decree(AdmitActorRequestSchema, clients.governance.admitActor, headers),
    removeActor: decree(RemoveActorRequestSchema, clients.governance.removeActor, headers),
    transferOwner: decree(TransferOwnerRequestSchema, clients.governance.transferOwner, headers),
    admitPeer: decree(AdmitPeerRequestSchema, clients.governance.admitPeer, headers),
    revokePeer: decree(RevokePeerRequestSchema, clients.governance.revokePeer, headers),
    rotateTransit: decree(RotateTransitRequestSchema, clients.governance.rotateTransit, headers),
  };
}

/**
 * A fire-and-forget governance RPC: every decree request carries an optional
 * dedup requestId whose null form must leave the wire field unset.
 */
function decree<Schema extends DescMessage>(
  schema: Schema,
  method: (request: MessageShape<Schema>, options: Readonly<{ headers: Headers }>) => Promise<unknown>,
  headers: () => Headers,
): (input: Omit<MessageInitShape<Schema>, "requestId"> & Readonly<{ requestId?: string | null }>) => Promise<void> {
  return async (input) => {
    const init = { ...input, requestId: input.requestId ?? undefined } as unknown as MessageInitShape<Schema>;
    await method(create(schema, init), { headers: headers() });
  };
}
