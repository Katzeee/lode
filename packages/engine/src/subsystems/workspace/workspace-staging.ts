import { createWorkspaceFromStorage } from "./workspace-storage.js";
import type { Workspace } from "./workspace.js";
import type { EventSink } from "../event/index.js";
import type { WorkspaceStorageStage } from "../persistence/index.js";
import type { WorkspaceReplica } from "./capability.js";
import { FactReplication } from "./fact-replication.js";

export type WorkspaceStaging = Readonly<{
  workspace: Workspace;
  replica: WorkspaceReplica;
  promote(): Promise<Readonly<{ workspaceId: string; label: string }>>;
  discard(): Promise<void>;
}>;

export async function createWorkspaceStaging(stagedStorage: WorkspaceStorageStage) {
  const workspace = await createWorkspaceFromStorage(stagedStorage.storage, { eventSink: silentEvents });
  const replica = createWorkspaceReplica(workspace);

  return {
    workspace,
    replica,
    promote: async () => {
      workspace.validate();
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
  const failures: Error[] = [];
  try {
    await workspace.close();
  } catch (error) {
    failures.push(toError(error));
  }
  try {
    await staged.discard();
  } catch (error) {
    failures.push(toError(error));
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, "Workspace staging failed to discard cleanly");
  }
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
    const failure = new AggregateError([toError(primary), toError(cleanupError)], message, { cause: primary });
    throw failure;
  }
  throw primary;
}
