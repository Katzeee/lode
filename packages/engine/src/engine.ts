import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { Engine, WorkspaceSummary } from "@lode/sdk/host";
import { AppRuntime } from "./runtime/kernel/app-runtime.js";
import { WorkspaceSessions } from "./runtime/workspace-sessions/index.js";
import { ProposalWorkspaceRegistry } from "./runtime/workspace/proposal-registry.js";
import { canonicalDigest } from "./domain/fact/index.js";

export type EngineOptions = Readonly<{
  persistence?: Readonly<{ dataRoot: string }>;
}>;

export async function createEngine(options: EngineOptions = {}): Promise<Engine> {
  const runtime = new AppRuntime("engine");
  const registry = new ProposalWorkspaceRegistry();
  const sessions = runtime.root.own(new WorkspaceSessions(registry, options.persistence?.dataRoot));
  await runtime.start();
  await sessions.startAll();

  let closePromise: Promise<void> | undefined;
  return {
    application: registry.contract,
    workspaces: {
      recoverAuthority: (workspaceId) => sessions.recoverAuthority(workspaceId),
      listWorkspaces: () => listWorkspaceSummaries(sessions),
      createWorkspace: (workspaceId, name) =>
        createWorkspace(registry, sessions, options.persistence?.dataRoot, workspaceId, name),
    },
    replicas: {
      synchronize: (workspaceId, peer) => sessions.synchronize(workspaceId, peer),
      peer: (workspaceId) => sessions.peer(workspaceId),
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
 * Create-only workspace entry: genesis, label seed, catalog record, and session
 * start in one step. A failure after genesis rolls the session and its storage
 * back out so a half-created workspace never lingers outside the catalog.
 */
async function createWorkspace(
  registry: ProposalWorkspaceRegistry,
  sessions: WorkspaceSessions,
  dataRoot: string | undefined,
  workspaceId: string,
  name: string,
): Promise<void> {
  if (name.length === 0) {
    throw new Error("Workspace name must not be empty");
  }
  if (sessions.isCataloged(workspaceId)) {
    const entry = (await sessions.catalogEntries()).find((candidate) => candidate.workspaceId === workspaceId);
    if (entry?.label === name) {
      return;
    }
    throw new Error(`Workspace ${workspaceId} already exists with a different name`);
  }
  let started = false;
  try {
    await sessions.load(workspaceId);
    started = true;
    await seedWorkspaceLabel(registry, workspaceId, name);
    await sessions.record(workspaceId, name);
  } catch (error) {
    if (started) {
      await sessions.discard(workspaceId).catch(() => {});
      await removeWorkspaceStorage(dataRoot, workspaceId).catch(() => {});
    }
    throw error;
  }
}

async function seedWorkspaceLabel(
  registry: ProposalWorkspaceRegistry,
  workspaceId: string,
  name: string,
): Promise<void> {
  const result = await registry.contract.execute({
    kind: "mutate",
    workspaceId,
    invocationId: `workspace-create/${workspaceId}`,
    actorId: "workspace-create",
    intent: "direct",
    historyChannelId: "workspace-create",
    mutations: [
      {
        kind: "text-splice",
        nodeId: workspaceId,
        deleteAtomIds: [],
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        insert: name,
      },
    ],
  });
  if (result.status !== "published") {
    throw new Error(`Workspace label seed failed: ${result.status}`);
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
