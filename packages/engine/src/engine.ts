import { rm } from "node:fs/promises";
import { join } from "node:path";

import {
  GovernanceAuthorizationError,
  GovernancePreconditionError,
  type Engine,
  type GovernanceSummary,
  type PeerExchangeWire,
  type ReplicaPeer,
  type WorkspaceSummary,
} from "@lode/sdk/host";
import { AppRuntime } from "./runtime/kernel/app-runtime.js";
import { WorkspaceSessions } from "./runtime/workspace-sessions/index.js";
import { ProposalWorkspaceRegistry } from "./runtime/workspace/proposal-registry.js";
import { type Admission, type FactSnapshot, canonicalDigest } from "./domain/fact/index.js";
import { syncAdmittedPeers } from "./domain/governance/index.js";
import { IdentityRuntime } from "./runtime/identity/identity-runtime.js";
import { PeerExchangeDialer, PeerExchangeServer } from "./runtime/identity/peer-exchange.js";
import {
  admitActor,
  admitPeer,
  establishGovernedWorkspace,
  governanceStateOf,
  openOwnTransitKey,
  removeActor,
  rotateTransit,
  transferOwnership,
} from "./runtime/identity/workspace-governance.js";
import { SyncExchange } from "./runtime/sync/sync-exchange.js";
import { wrappedApplication } from "./runtime/engine-contract.js";
import { validateAdoptionSnapshot } from "./runtime/workspace-sessions/adoption.js";

export type EngineOptions = Readonly<{
  persistence?: Readonly<{ dataRoot: string }>;
  /** Dials a remote replica-exchange boundary; the daemon host provides it. */
  dialExchange?: (endpoint: string) => PeerExchangeWire;
}>;

export async function createEngine(options: EngineOptions = {}): Promise<Engine> {
  const runtime = new AppRuntime("engine");
  const registry = new ProposalWorkspaceRegistry();
  const identity = await IdentityRuntime.open(options.persistence?.dataRoot);
  const signFact = (digest: string, actorId: string): string => identity.signFact(digest, actorId);
  const sessions = runtime.root.own(new WorkspaceSessions(registry, options.persistence?.dataRoot, signFact));
  const remotes = new PeerExchangeServer(identity, (workspaceId) => ({
    workspaceId,
    label: sessions.servingWorkspace(workspaceId).label,
    facts: sessions.authority(workspaceId),
    peer: () => sessions.servingWorkspace(workspaceId).peer(),
  }));
  await runtime.start();
  await sessions.startAll();

  let closePromise: Promise<void> | undefined;
  return {
    application: wrappedApplication(registry.contract, { identity, sessions }),
    identity: {
      listActors: () =>
        Promise.resolve({
          vaultExists: identity.vaultExists(),
          actors: identity.listActors(),
        }),
      createActor: async (input) => {
        const created = await identity.createActor({ label: input.label, passphrase: input.passphrase });
        return { actorId: created.actorId, recoveryPhrase: created.phrase };
      },
      importActor: (input) =>
        identity.importActor({ phrase: input.recoveryPhrase, passphrase: input.passphrase, label: input.label }),
      unlockVault: async (passphrase) => ({
        vaultExists: identity.vaultExists(),
        actors: await identity.unlock(passphrase),
      }),
      lockVault: async () => {
        await Promise.resolve(identity.lock());
      },
      peerMaterial: () =>
        Promise.resolve({
          peerId: identity.peer().peerId,
          peerIdentityPublicKey: Buffer.from(identity.peer().identity.publicKey).toString("base64"),
          peerKxPublicKey: Buffer.from(identity.peer().exchange.publicKey).toString("base64"),
          actorIds: identity.listActors().map((actor) => actor.actorId),
        }),
    },
    governance: {
      summary: (workspaceId) => Promise.resolve(governanceSummary(sessions, workspaceId)),
      admitActor: (input) =>
        governedCommit(sessions, input.workspaceId, admitActor(sessions.authority(input.workspaceId), input)),
      removeActor: (input) =>
        governedCommit(sessions, input.workspaceId, removeActor(sessions.authority(input.workspaceId), input)),
      transferOwner: (input) =>
        governedCommit(sessions, input.workspaceId, transferOwnership(sessions.authority(input.workspaceId), input)),
      admitPeer: (input) =>
        governedCommit(sessions, input.workspaceId, admitPeer(identity, sessions.authority(input.workspaceId), input)),
      revokePeer: (input) => governedCommit(sessions, input.workspaceId, revokePeer(sessions, input)),
      rotateTransit: (input) => governedCommit(sessions, input.workspaceId, rotateTransitFor(sessions, input)),
    },
    workspaces: {
      recoverAuthority: (workspaceId) => sessions.recoverAuthority(workspaceId),
      listWorkspaces: () => listWorkspaceSummaries(sessions),
      createWorkspace: (input) => createGovernedWorkspace(identity, sessions, options.persistence?.dataRoot, input),
      adoptWorkspace: (input) => adoptWorkspace(identity, sessions, options.dialExchange, input),
    },
    replicas: {
      synchronize: (workspaceId, peer) => sessions.synchronize(workspaceId, peer),
      peer: (workspaceId) => sessions.peer(workspaceId),
      remotePeer: (endpoint, workspaceId) =>
        Promise.resolve(remotePeer(identity, options.dialExchange, endpoint, workspaceId)),
    },
    remotes: {
      exchangeProfile: (proof) => remotes.exchangeProfile(proof),
      exchangeFetch: (proof, documentId, sealedFrom) => remotes.exchangeFetch(proof, documentId, sealedFrom),
      exchangeSend: (proof, documentId, sealedPayload) => remotes.exchangeSend(proof, documentId, sealedPayload),
    },
    close: () => (closePromise ??= closeEngine(runtime)),
  };
}

async function closeEngine(runtime: AppRuntime): Promise<void> {
  const report = await runtime.stop();
  if (report.errors.length > 0) {
    throw new AggregateError(report.errors, "Engine failed to close cleanly");
  }
}

/** Every governance commit advances the authority directly, so the hosted
 * projection republishes before the next command observes it. */
async function governedCommit(
  sessions: WorkspaceSessions,
  workspaceId: string,
  committed: Promise<unknown>,
): Promise<void> {
  await committed;
  await sessions.reconcile(workspaceId);
}

function remotePeer(
  identity: IdentityRuntime,
  dial: ((endpoint: string) => PeerExchangeWire) | undefined,
  endpoint: string,
  workspaceId: string,
): ReplicaPeer {
  if (!dial) {
    throw new Error("This engine host cannot dial remote replica exchanges");
  }
  return new PeerExchangeDialer(identity, workspaceId, dial(endpoint)).peer();
}

/** Revocation is rotation by omission: every currently admitted Peer minus the revoked one. */
async function revokePeer(
  sessions: WorkspaceSessions,
  input: Readonly<{ workspaceId: string; actingActorId: string; peerId: string; requestId?: string }>,
): Promise<void> {
  const facts = sessions.authority(input.workspaceId);
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
  sessions: WorkspaceSessions,
  input: Readonly<{ workspaceId: string; actingActorId: string; requestId?: string }>,
): Promise<void> {
  const facts = sessions.authority(input.workspaceId);
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

function governanceSummary(sessions: WorkspaceSessions, workspaceId: string): GovernanceSummary {
  const state = governanceStateOf(admissionSnapshot(sessions.authority(workspaceId)));
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

/** Catalog plus live run state; the catalog label is authoritative for `list`. */
async function listWorkspaceSummaries(sessions: WorkspaceSessions): Promise<readonly WorkspaceSummary[]> {
  const entries = await sessions.catalogEntries();
  return entries.map((entry) => ({
    workspaceId: entry.workspaceId,
    label: entry.label,
    state: sessions.state(entry.workspaceId),
  }));
}

/**
 * Create-only governed workspace entry: establish, genesis, and label land in
 * one authority commit under the owner Actor's signature. A failure after the
 * commit rolls the session and its storage back out so a half-created
 * workspace never lingers outside the catalog.
 */
async function createGovernedWorkspace(
  identity: IdentityRuntime,
  sessions: WorkspaceSessions,
  dataRoot: string | undefined,
  input: Readonly<{ workspaceId: string; label: string; ownerActorId: string }>,
): Promise<void> {
  if (input.label.length === 0) {
    throw new Error("Workspace name must not be empty");
  }
  if (sessions.isCataloged(input.workspaceId)) {
    const existing = (await sessions.catalogEntries()).find((entry) => entry.workspaceId === input.workspaceId);
    if (existing?.label === input.label) {
      return;
    }
    throw new Error(`Workspace ${input.workspaceId} already exists with a different name`);
  }
  if (!identity.isActorUnlocked(input.ownerActorId)) {
    throw new Error(`Actor ${input.ownerActorId} has no unlocked key; unlock the vault first`);
  }
  // The session hosts first, the establish commit lands on its authority, and
  // a reconcile publishes the projection over the new frontier. A failure
  // rolls the session and its storage back out so a half-created workspace
  // never lingers outside the catalog.
  let started = false;
  try {
    await sessions.load(input.workspaceId);
    started = true;
    await establishGovernedWorkspace(identity, sessions.authority(input.workspaceId), input.workspaceId, {
      ownerActorId: input.ownerActorId,
      label: input.label,
    });
    await sessions.reconcile(input.workspaceId);
    await sessions.record(input.workspaceId, input.label);
  } catch (error) {
    if (started) {
      await sessions.discard(input.workspaceId).catch(() => {});
      await removeWorkspaceStorage(dataRoot, input.workspaceId).catch(() => {});
    }
    throw error;
  }
}

/**
 * Staged adoption of a remote workspace: pull the unified journal from an
 * empty frontier into invisible staging, verify governance admits this Home's
 * Peer at the current transit epoch, then promote atomically into the
 * catalog. Failures leave no queryable trace.
 */
async function adoptWorkspace(
  identity: IdentityRuntime,
  sessions: WorkspaceSessions,
  dial: ((endpoint: string) => PeerExchangeWire) | undefined,
  input: Readonly<{ endpoint: string; workspaceId: string }>,
): Promise<Readonly<{ workspaceId: string; label: string }>> {
  if (!dial) {
    throw new Error("This engine host cannot dial remote replica exchanges");
  }
  if (sessions.isCataloged(input.workspaceId)) {
    throw new Error(`Workspace ${input.workspaceId} already exists`);
  }
  const staging = await sessions.stage(input.workspaceId);
  try {
    const dialer = new PeerExchangeDialer(identity, input.workspaceId, dial(input.endpoint));
    const opened = await staging.open();
    const exchanged = await new SyncExchange(opened.sync, dialer.peer()).sync();
    if (exchanged.pulled === 0) {
      throw new Error(`Remote ${input.endpoint} served no journal for workspace ${input.workspaceId}`);
    }
    const admission = opened.facts.admission();
    if (admission.kind !== "ready") {
      throw new Error(
        admission.kind === "fault"
          ? `Adopted journal failed admission: ${admission.fault ?? "unknown fault"}`
          : `Adopted journal is incomplete: ${admission.pendingTransactionIds.join(", ")}`,
      );
    }
    const state = governanceStateOf(admission.snapshot);
    if (!state.established) {
      throw new Error("Remote journal is not governed; nothing to adopt");
    }
    // Opening our own envelope proves this Home's Peer is admitted at the
    // current transit epoch — the same fact the exchange itself verified.
    openOwnTransitKey(identity, state);
    const { label } = validateAdoptionSnapshot(input.workspaceId, admission.snapshot);
    await sessions.promoteAdoption(input.workspaceId, staging, label);
    return { workspaceId: input.workspaceId, label };
  } catch (error) {
    await staging.discard().catch(() => {});
    throw error;
  }
}

async function removeWorkspaceStorage(dataRoot: string | undefined, workspaceId: string): Promise<void> {
  if (dataRoot === undefined) {
    return;
  }
  const base = join(dataRoot, "workspaces", `${canonicalDigest(workspaceId)}.sqlite`);
  for (const suffix of ["", "-wal", "-shm"]) {
    await rm(`${base}${suffix}`, { force: true });
  }
}
