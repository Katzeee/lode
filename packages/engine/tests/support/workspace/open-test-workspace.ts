import type { EngineCommand, WriteResult } from "@lode/sdk";

import { graphActionBody, workspaceGenesisActions } from "../../../src/domain/fact/index.js";
import { createWorkspaceApplication } from "../../../src/subsystems/workspace/workspace-application.js";
import { workspaceGenesisFact } from "../../../src/subsystems/workspace/authority-coordination/index.js";
import { Workspace } from "../../../src/subsystems/workspace/workspace.js";
import type { EventSink } from "../../../src/subsystems/event/index.js";
import type { WorkspaceStorage } from "../../../src/subsystems/persistence/index.js";
import { InMemoryDocumentStore } from "../document-store.js";

type WorkspaceOptions = Parameters<typeof Workspace.open>[0];
type TestWorkspaceOptions = Omit<WorkspaceOptions, "eventSink" | "storage"> &
  Partial<Pick<WorkspaceOptions, "eventSink" | "storage">> &
  Readonly<{ seedGenesis?: boolean }>;

export type TestWorkspace = Workspace &
  Readonly<{
    execute(command: EngineCommand): Promise<WriteResult>;
  }>;

export async function openTestWorkspace(options: TestWorkspaceOptions): Promise<TestWorkspace> {
  const {
    seedGenesis = true,
    eventSink = silentEvents,
    storage = testWorkspaceStorage(options.workspaceId),
    ...workspaceOptions
  } = options;
  if (seedGenesis) {
    await seedTestWorkspaceGenesis(options.workspaceId, options.facts);
  }
  const workspace = Workspace.open({ ...workspaceOptions, eventSink, storage });
  const application = createWorkspaceApplication({
    resolve: (workspaceId) => (workspaceId === workspace.workspaceId ? workspace : undefined),
    stopRequested: () => false,
  });
  return Object.assign(workspace, { execute: application.execute });
}

const silentEvents: EventSink = { publish: () => undefined };

function testWorkspaceStorage(workspaceId: string): WorkspaceStorage {
  return {
    workspaceId,
    facts: new InMemoryDocumentStore(),
    metadata: new InMemoryDocumentStore(),
    release: () => Promise.resolve(),
  };
}

async function seedTestWorkspaceGenesis(
  workspaceId: string,
  facts: Parameters<typeof Workspace.open>[0]["facts"],
): Promise<void> {
  const snapshot = facts.snapshot();
  if (snapshot.facts.length > 0) {
    workspaceGenesisFact(workspaceId, snapshot.facts);
    return;
  }
  if (facts.receipts().length > 0) {
    throw new Error("Workspace authority is missing its complete genesis Fact");
  }
  await facts.commit({
    invocationId: `workspace-genesis/${facts.replicaId}`,
    request: { kind: "workspace-genesis", workspaceId },
    writes: [graphActionBody("workspace-genesis", "direct", workspaceGenesisActions(workspaceId))],
    lineage: null,
    publishedFrontier: snapshot.frontier,
  });
}
