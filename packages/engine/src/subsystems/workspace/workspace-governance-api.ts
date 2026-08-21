import {
  GovernanceAuthorizationError,
  GovernancePreconditionError,
  type EngineGovernance,
  type GovernanceSummary,
} from "@lode/sdk/host";

import { type Admission, type FactSnapshot } from "../../domain/fact/index.js";
import { syncAdmittedPeers } from "../../domain/governance/index.js";
import type { IdentityCapability } from "../identity/index.js";
import type { WorkspaceCapability } from "./capability.js";
import {
  admitActor,
  admitPeer,
  governanceStateOf,
  removeActor,
  rotateTransit,
  transferOwnership,
} from "./workspace-governance.js";

export function createWorkspaceGovernanceApi(
  identity: IdentityCapability,
  workspace: WorkspaceCapability,
): EngineGovernance {
  return {
    summary: (workspaceId) => Promise.resolve(governanceSummary(workspace, workspaceId)),
    admitActor: (input) =>
      governedCommit(workspace, input.workspaceId, admitActor(workspace.authority(input.workspaceId), input)),
    removeActor: (input) =>
      governedCommit(workspace, input.workspaceId, removeActor(workspace.authority(input.workspaceId), input)),
    transferOwner: (input) =>
      governedCommit(workspace, input.workspaceId, transferOwnership(workspace.authority(input.workspaceId), input)),
    admitPeer: (input) =>
      governedCommit(
        workspace,
        input.workspaceId,
        admitPeer(identity.peer, workspace.authority(input.workspaceId), input),
      ),
    revokePeer: (input) => governedCommit(workspace, input.workspaceId, revokePeer(workspace, input)),
    rotateTransit: (input) => governedCommit(workspace, input.workspaceId, rotateTransitFor(workspace, input)),
  };
}

async function governedCommit(
  workspace: WorkspaceCapability,
  workspaceId: string,
  committed: Promise<unknown>,
): Promise<void> {
  await committed;
  await workspace.reconcile(workspaceId);
}

async function revokePeer(
  workspace: WorkspaceCapability,
  input: Readonly<{ workspaceId: string; actingActorId: string; peerId: string; requestId?: string }>,
): Promise<void> {
  const facts = workspace.authority(input.workspaceId);
  const state = governanceStateOf(admissionSnapshot(facts));
  if (state.ownerActorId !== input.actingActorId) {
    throw new GovernanceAuthorizationError(`Actor is not the Workspace owner: ${input.actingActorId}`);
  }
  if (!syncAdmittedPeers(state).has(input.peerId)) {
    throw new GovernancePreconditionError(`Peer is not admitted at the current transit epoch: ${input.peerId}`);
  }
  const admitted = [...syncAdmittedPeers(state).keys()].filter((peerId) => peerId !== input.peerId);
  await rotateTransit(facts, { ...input, survivingPeerIds: admitted });
}

async function rotateTransitFor(
  workspace: WorkspaceCapability,
  input: Readonly<{ workspaceId: string; actingActorId: string; requestId?: string }>,
): Promise<void> {
  const facts = workspace.authority(input.workspaceId);
  const state = governanceStateOf(admissionSnapshot(facts));
  await rotateTransit(facts, { ...input, survivingPeerIds: [...syncAdmittedPeers(state).keys()] });
}

function admissionSnapshot(facts: { admission(): Admission }): FactSnapshot {
  const admission = facts.admission();
  if (admission.kind === "fault") {
    throw new Error(admission.fault ?? "Workspace authority is faulted");
  }
  return admission.snapshot;
}

function governanceSummary(workspace: WorkspaceCapability, workspaceId: string): GovernanceSummary {
  const state = governanceStateOf(admissionSnapshot(workspace.authority(workspaceId)));
  const admitted = syncAdmittedPeers(state);
  return {
    established: state.established,
    ownerActorId: state.ownerActorId,
    memberActorIds: [...state.members],
    epoch: state.epoch,
    peers: [...state.peers.values()].map((peer) => ({
      peerId: peer.peerId,
      peerKxPublicKey: peer.kxPublicKey,
      admittedAtEpoch: peer.admittedAtEpoch,
      admittedByActorId: peer.admittedByActorId,
      syncAdmitted: admitted.has(peer.peerId),
    })),
  };
}
