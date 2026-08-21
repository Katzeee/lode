import { createWorkspaceFromStorage } from "./workspace-storage.js";
import type { Workspace } from "./workspace.js";
import type { EventSink } from "../event/index.js";
import type { WorkspaceStorageStage } from "../persistence/index.js";
import type { WorkspaceReplica } from "./capability.js";
import { FactReplication } from "./fact-replication.js";
import { validateWorkspaceSnapshot } from "./workspace-validation.js";

export type WorkspaceStaging = Readonly<{
  workspace: Workspace;
  replica: WorkspaceReplica;
  promote(): Promise<Readonly<{ workspaceId: string; label: string }>>;
  discard(): Promise<void>;
}>;

export async function createWorkspaceStaging(
  workspaceId: string,
  stagedStorage: WorkspaceStorageStage,
  signFact: (digest: string, actorId: string) => string,
) {
  const workspace = await createWorkspaceFromStorage(stagedStorage.storage, { eventSink: silentEvents, signFact });
  const replica = createWorkspaceReplica(workspace);

  return {
    workspace,
    replica,
    promote: async () => {
      validateWorkspaceSnapshot(workspaceId, workspace.facts.admission().snapshot);
      await workspace.close();
      return stagedStorage.promote();
    },
    discard: () => discard(workspace, stagedStorage),
  };
}

export function createWorkspaceReplica(workspace: Workspace): WorkspaceReplica {
  return {
    facts: workspace.facts,
    sync: new FactReplication(workspace.replicationDocument, () => workspace.reconcileAuthorityAdvance()),
  };
}

async function discard(workspace: Workspace, staged: WorkspaceStorageStage): Promise<void> {
  await workspace.close();
  await staged.discard();
}

const silentEvents: EventSink = { publish: () => {} };

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export async function failWorkspaceCleanup(
  primary: unknown,
  cleanup: () => void | Promise<void>,
  message: string,
): Promise<never> {
  try {
    await cleanup();
  } catch (cleanupError) {
    throw new AggregateError([toError(primary), toError(cleanupError)], message, { cause: cleanupError });
  }
  throw primary;
}
