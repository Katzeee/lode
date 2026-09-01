import { GovernanceAuthorizationError, GovernancePreconditionError } from "@lode/sdk/host";
import {
  base64ToBytes,
  bytesToBase64,
  isActorId,
  isPeerId,
  randomBytes,
  randomUuid,
  sealToPublicKey,
} from "../../crypto/index.js";
import { projectGovernance, syncAdmittedPeers, type GovernanceState } from "../../domain/governance/index.js";
import {
  END_SEQUENCE_ANCHOR as end,
  workspaceGenesisActions,
  type FactBody,
  type FactSnapshot,
  type GovernanceAction,
  type TransitEnvelope,
  type WorkspaceId,
} from "../../domain/fact/index.js";
import type { FactAuthorityPort } from "./authority/authority-contract.js";
import type { PeerIdentityCapability } from "../identity/capability.js";

/**
 * Workspace governance operations commit Facts under the acting Actor identity;
 * transit material is derived locally — sealed to the target Peer,
 * or opened from this Home's own envelope when re-wrapping for someone else.
 */

export type GovernanceAuthority = Pick<FactAuthorityPort, "commit" | "snapshot" | "replicaId">;

type PeerAdmissionMaterial = Readonly<{
  peerId: string;
  peerKxPublicKey: string;
}>;

class GovernanceError extends GovernancePreconditionError {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceError";
  }
}

export function governanceStateOf(snapshot: FactSnapshot): GovernanceState {
  return projectGovernance(snapshot.facts);
}

/** Creates a governed workspace authority: establish, first Peer, genesis, label. */
export async function establishGovernedWorkspace(
  identity: PeerIdentityCapability,
  facts: GovernanceAuthority,
  workspaceId: WorkspaceId,
  input: Readonly<{ ownerActorId: string; label: string }>,
): Promise<void> {
  const state = governedState(facts);
  if (state.established) {
    throw new GovernanceError("Workspace authority is already governed");
  }
  const peerId = identity.peerId();
  const exchangePublicKey = identity.exchangePublicKey();
  const transitKey = randomBytes(32);
  const genesisActions = workspaceGenesisActions(workspaceId);
  const writes: readonly FactBody[] = [
    governanceBody(input.ownerActorId, { kind: "workspace-establish", ownerActorId: input.ownerActorId }),
    governanceBody(input.ownerActorId, {
      kind: "peer-admit",
      peerId,
      peerKxPublicKey: toBase64(exchangePublicKey),
      envelope: sealTransitKey(transitKey, exchangePublicKey),
      epoch: 0,
    }),
    { kind: "action", actorId: input.ownerActorId, intent: "direct", actions: genesisActions },
    {
      kind: "action",
      actorId: input.ownerActorId,
      intent: "direct",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: workspaceId,
          deleteAtomIds: [],
          anchor: end,
          insert: input.label,
        },
      ] as const,
    },
  ];
  await commitSigned(facts, {
    invocationId: `workspace-establish/${workspaceId}`,
    request: { kind: "workspace-establish", workspaceId, ownerActorId: input.ownerActorId },
    writes,
  });
}

export async function admitActor(
  facts: GovernanceAuthority,
  input: Readonly<{ workspaceId: WorkspaceId; actingActorId: string; actorId: string; requestId?: string }>,
): Promise<void> {
  const state = requireOwner(facts, input.actingActorId);
  if (!isActorId(input.actorId)) {
    throw new GovernanceError(`Actor id is not a valid signing identity: ${input.actorId}`);
  }
  if (state.members.has(input.actorId)) {
    return;
  }
  await commitSigned(facts, {
    invocationId: governanceInvocation(input.workspaceId, "actor-admit", input.requestId),
    request: { kind: "actor-admit", workspaceId: input.workspaceId, actorId: input.actorId },
    writes: [governanceBody(input.actingActorId, { kind: "actor-admit", actorId: input.actorId })],
  });
}

export async function removeActor(
  facts: GovernanceAuthority,
  input: Readonly<{ workspaceId: WorkspaceId; actingActorId: string; actorId: string; requestId?: string }>,
): Promise<void> {
  const state = requireOwner(facts, input.actingActorId);
  if (input.actorId === state.ownerActorId) {
    throw new GovernanceError("The Workspace owner cannot remove itself");
  }
  if (!state.members.has(input.actorId)) {
    throw new GovernanceError(`Actor is not a Workspace member: ${input.actorId}`);
  }
  await commitSigned(facts, {
    invocationId: governanceInvocation(input.workspaceId, "actor-remove", input.requestId),
    request: { kind: "actor-remove", workspaceId: input.workspaceId, actorId: input.actorId },
    writes: [governanceBody(input.actingActorId, { kind: "actor-remove", actorId: input.actorId })],
  });
}

export async function transferOwnership(
  facts: GovernanceAuthority,
  input: Readonly<{ workspaceId: WorkspaceId; actingActorId: string; nextOwnerActorId: string; requestId?: string }>,
): Promise<void> {
  const state = requireOwner(facts, input.actingActorId);
  if (input.nextOwnerActorId === state.ownerActorId) {
    return;
  }
  if (!state.members.has(input.nextOwnerActorId)) {
    throw new GovernanceError(`Next owner is not a Workspace member: ${input.nextOwnerActorId}`);
  }
  await commitSigned(facts, {
    invocationId: governanceInvocation(input.workspaceId, "owner-transfer", input.requestId),
    request: {
      kind: "owner-transfer",
      workspaceId: input.workspaceId,
      nextOwnerActorId: input.nextOwnerActorId,
    },
    writes: [
      governanceBody(input.actingActorId, {
        kind: "owner-transfer",
        nextOwnerActorId: input.nextOwnerActorId,
      }),
    ],
  });
}

export async function admitPeer(
  identity: PeerIdentityCapability,
  facts: GovernanceAuthority,
  input: Readonly<
    {
      workspaceId: WorkspaceId;
      actingActorId: string;
      requestId?: string;
    } & PeerAdmissionMaterial
  >,
): Promise<void> {
  const state = requireEstablished(facts);
  requireMember(state, input.actingActorId);
  if (!isPeerId(input.peerId)) {
    throw new GovernanceError(`Peer id is not a valid device identity: ${input.peerId}`);
  }
  const transitKey = openOwnTransitKey(identity, state);
  const kxPublicKey = decodePublicKey(input.peerKxPublicKey);
  await commitSigned(facts, {
    invocationId: governanceInvocation(input.workspaceId, "peer-admit", input.requestId),
    request: { kind: "peer-admit", workspaceId: input.workspaceId, peerId: input.peerId },
    writes: [
      governanceBody(input.actingActorId, {
        kind: "peer-admit",
        peerId: input.peerId,
        peerKxPublicKey: input.peerKxPublicKey,
        envelope: sealTransitKey(transitKey, kxPublicKey),
        epoch: state.epoch,
      }),
    ],
  });
}

/**
 * Rotates the transit key to a fresh secret for every surviving Peer. Peers
 * omitted from the roster lose admission and cannot open anything sealed
 * afterwards — revocation is rotation by omission.
 */
export async function rotateTransit(
  facts: GovernanceAuthority,
  input: Readonly<{
    workspaceId: WorkspaceId;
    actingActorId: string;
    survivingPeerIds: readonly string[];
    requestId?: string;
  }>,
): Promise<void> {
  const state = requireEstablished(facts);
  requireOwnerState(state, input.actingActorId);
  const admitted = syncAdmittedPeers(state);
  if (input.survivingPeerIds.length === 0) {
    throw new GovernanceError("Transit rotation requires at least one surviving Peer");
  }
  const newKey = randomBytes(32);
  const roster = input.survivingPeerIds.map((peerId) => {
    const peer = admitted.get(peerId);
    if (!peer) {
      throw new GovernanceError(`Peer is not admitted at the current transit epoch: ${peerId}`);
    }
    return { peerId, envelope: sealTransitKey(newKey, decodePublicKey(peer.kxPublicKey)) };
  });
  await commitSigned(facts, {
    invocationId: governanceInvocation(input.workspaceId, "transit-rotate", input.requestId),
    request: { kind: "transit-rotate", workspaceId: input.workspaceId, epoch: state.epoch + 1 },
    writes: [governanceBody(input.actingActorId, { kind: "transit-rotate", epoch: state.epoch + 1, peers: roster })],
  });
}

/** The current transit key for this Home's own admitted Peer. */
export function openOwnTransitKey(identity: PeerIdentityCapability, state: GovernanceState): Uint8Array {
  const peerId = identity.peerId();
  const admitted = syncAdmittedPeers(state).get(peerId);
  if (!admitted) {
    throw new GovernanceError(`This Home's Peer is not admitted at the current transit epoch: ${peerId}`);
  }
  return identity.openEnvelope(envelopeToBytes(admitted.envelope));
}

function commitSigned(
  facts: GovernanceAuthority,
  input: Readonly<{
    invocationId: string;
    request: unknown;
    writes: readonly FactBody[];
  }>,
): Promise<unknown> {
  const snapshot = facts.snapshot();
  return facts.commit({
    invocationId: input.invocationId,
    request: input.request,
    writes: input.writes,
    lineage: null,
    publishedFrontier: snapshot.frontier,
  });
}

function governedState(facts: GovernanceAuthority): GovernanceState {
  const snapshot = facts.snapshot();
  return governanceStateOf(snapshot);
}

function requireEstablished(facts: GovernanceAuthority): GovernanceState {
  const state = governedState(facts);
  if (!state.established) {
    throw new GovernanceError("Workspace is not governed; establish it first");
  }
  return state;
}

function requireOwner(facts: GovernanceAuthority, actorId: string): GovernanceState {
  const state = requireEstablished(facts);
  requireOwnerState(state, actorId);
  return state;
}

function requireOwnerState(state: GovernanceState, actorId: string): void {
  if (state.ownerActorId !== actorId) {
    throw new GovernanceAuthorizationError(`Actor is not the Workspace owner: ${actorId}`);
  }
}

function requireMember(state: GovernanceState, actorId: string): void {
  if (!state.members.has(actorId)) {
    throw new GovernanceAuthorizationError(`Actor is not a Workspace member: ${actorId}`);
  }
}

function governanceInvocation(workspaceId: WorkspaceId, action: string, requestId?: string): string {
  return `governance/${workspaceId}/${action}/${requestId ?? randomUuid()}`;
}

function governanceBody(actorId: string, action: GovernanceAction): FactBody {
  return { kind: "governance", actorId, action };
}

function sealTransitKey(key: Uint8Array, peerKxPublicKey: Uint8Array): TransitEnvelope {
  const sealed = sealToPublicKey(key, peerKxPublicKey);
  return {
    ephemeral: toBase64(sealed.subarray(0, 32)),
    seal: toBase64(sealed.subarray(32)),
  };
}

function envelopeToBytes(envelope: TransitEnvelope): Uint8Array {
  return new Uint8Array([...decodeBase64(envelope.ephemeral), ...decodeBase64(envelope.seal)]);
}

function decodePublicKey(value: string): Uint8Array {
  const key = decodeBase64(value);
  if (key.length !== 32) {
    throw new GovernanceError("Peer exchange public key must be base64 of 32 bytes");
  }
  return key;
}

function decodeBase64(value: string): Uint8Array {
  return base64ToBytes(value);
}

function toBase64(value: Uint8Array): string {
  return bytesToBase64(value);
}
