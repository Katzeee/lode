import type {
  EngineCommand,
  EngineQuery,
  EngineQueryForKind,
  EngineQueryInput,
  EngineQueryKind,
  EngineQueryResult,
  WriteResult,
} from "@lode/sdk";
import { WorkspaceNotFoundError } from "@lode/sdk/host";

import { parseEngineCommand, parseEngineQuery, type AcceptedEngineCommand } from "./application/input-validation.js";
import { establishGovernedWorkspace } from "./workspace-governance.js";
import { SerialExecutor } from "./serial-executor.js";
import { createWorkspaceFromStorage } from "./workspace-storage.js";
import type { Workspace } from "./workspace.js";
import { defineEngineSubsystem, type EngineSubsystemReference } from "../definition.js";
import type { EngineSubsystemControl } from "../subsystem.js";
import type { EventSink } from "../event/index.js";
import type { IdentityCapability } from "../identity/index.js";
import type { PersistenceCapability, WorkspaceStorage, WorkspaceStorageFactory } from "../persistence/index.js";
import type { StagedWorkspaceReplica, WorkspaceCapability, WorkspaceReplica } from "./capability.js";
import { invalidInput, invalidWrite, workspaceNotFound, workspaceUnavailable } from "./workspace-errors.js";
import { createWorkspaceReplica, failWorkspaceCleanup } from "./workspace-staging.js";
import { WorkspaceStagingCollection } from "./workspace-staging-collection.js";

type WorkspaceIdentity = Pick<IdentityCapability, "vault" | "peer">;

type WorkspaceRegistryEntry = Readonly<{
  workspace: Workspace;
  replica: WorkspaceReplica;
}>;

export function createWorkspaceSubsystemDefinition(
  persistence: EngineSubsystemReference<PersistenceCapability>,
  event: EngineSubsystemReference<EventSink>,
  identity: EngineSubsystemReference<WorkspaceIdentity>,
) {
  return defineEngineSubsystem({
    id: "workspace",
    dependencies: { persistence, event, identity },
    create: ({ persistence: persistenceCapability, event: eventSink, identity: identityCapability }, control) => {
      const collection = new WorkspaceCollection(
        persistenceCapability.workspaceStorage,
        eventSink,
        identityCapability,
        control,
      );
      return {
        capability: collection.capability,
        init: () => collection.init(),
        stop: () => collection.stop(),
      };
    },
  });
}

class WorkspaceCollection {
  private readonly residents = new Map<string, WorkspaceRegistryEntry>();
  private readonly stagings: WorkspaceStagingCollection;
  private readonly transitions = new SerialExecutor();

  readonly capability: WorkspaceCapability = {
    application: {
      execute: (command) => this.execute(command),
      query: (query) => this.query(query),
    },
    list: () => {
      this.assertRunning();
      return Promise.resolve(this.summaries());
    },
    authority: (workspaceId) => {
      this.assertRunning();
      return this.resident(workspaceId).workspace.facts;
    },
    reconcile: (workspaceId) => {
      this.assertRunning();
      return this.resident(workspaceId).workspace.reconcileAuthorityAdvance();
    },
    create: (input) => this.transitions.run(() => this.create(input)),
    stage: (workspaceId) => this.transitions.run(() => this.stage(workspaceId)),
    replica: (workspaceId) => {
      this.assertRunning();
      return this.resident(workspaceId).replica;
    },
  };

  constructor(
    private readonly storage: WorkspaceStorageFactory,
    private readonly events: EventSink,
    private readonly identity: WorkspaceIdentity,
    private readonly control: EngineSubsystemControl,
  ) {
    this.stagings = new WorkspaceStagingCollection(storage, async (finalStorage) => {
      const resident = await this.openResident(finalStorage);
      this.residents.set(finalStorage.workspaceId, resident);
      return resident.workspace.label;
    });
  }

  async init(): Promise<void> {
    for (const workspaceId of await this.storage.list()) {
      const openedStorage = await this.storage.open(workspaceId);
      const resident = await this.openResident(openedStorage);
      this.residents.set(workspaceId, resident);
    }
  }

  async stop(): Promise<void> {
    return this.transitions.run(() => this.stopWorkspaces());
  }

  private async stopWorkspaces(): Promise<void> {
    await this.stagings.stop();
    for (const [workspaceId, resident] of [...this.residents.entries()].reverse()) {
      await resident.workspace.close();
      this.residents.delete(workspaceId);
    }
  }

  private summaries() {
    return [...this.residents.entries()].map(([workspaceId, resident]) => ({
      workspaceId,
      label: resident.workspace.label,
    }));
  }

  private async create(input: Readonly<{ workspaceId: string; label: string; ownerActorId: string }>): Promise<void> {
    this.assertRunning();
    if (input.label.trim().length === 0) {
      throw new Error("Workspace name must not be empty");
    }
    this.assertAbsent(input.workspaceId);
    if (!this.identity.vault.isActorUnlocked(input.ownerActorId)) {
      throw new Error(`Actor ${input.ownerActorId} has no unlocked key; unlock the vault first`);
    }
    const staging = await this.stagings.open(input.workspaceId);
    try {
      await establishGovernedWorkspace(this.identity.peer, staging.workspace.facts, input.workspaceId, input);
      await staging.workspace.reconcileAuthorityAdvance();
      await staging.promote();
    } catch (error) {
      return failWorkspaceCleanup(error, staging.discard, "Workspace creation failed to clean up staging");
    }
  }

  private stage(workspaceId: string): Promise<StagedWorkspaceReplica> {
    this.assertRunning();
    this.assertAbsent(workspaceId);
    return this.stagings.open(workspaceId).then((staging) => ({
      workspaceId,
      facts: staging.workspace.facts,
      sync: staging.replica.sync,
      promote: () => this.transitions.run(() => staging.promote()),
      discard: () => this.transitions.run(() => staging.discard()),
    }));
  }

  private async openResident(storage: WorkspaceStorage): Promise<WorkspaceRegistryEntry> {
    const stored = await this.open(storage, this.events);
    try {
      void stored.label;
      return { workspace: stored, replica: createWorkspaceReplica(stored) };
    } catch (error) {
      return failWorkspaceCleanup(error, () => stored.close(), "Workspace validation failed to close storage");
    }
  }

  private open(storage: WorkspaceStorage, eventSink: EventSink) {
    return createWorkspaceFromStorage(storage, { eventSink });
  }

  private execute(command: EngineCommand): Promise<WriteResult> {
    if (this.control.stopRequested) {
      return Promise.resolve({ status: "rejected", error: workspaceUnavailable("Engine is stopping") });
    }
    let parsed: AcceptedEngineCommand;
    try {
      parsed = parseEngineCommand(command);
    } catch (error) {
      return Promise.resolve(invalidWrite(error));
    }
    const resident = this.residents.get(parsed.workspaceId);
    return resident
      ? resident.workspace.executeAccepted(parsed)
      : Promise.resolve({ status: "rejected", error: workspaceNotFound(parsed.workspaceId) });
  }

  private query<Kind extends EngineQueryKind>(
    query: EngineQueryInput<Kind>,
  ): Promise<EngineQueryResult<EngineQueryForKind<Kind>>>;
  private async query(query: EngineQuery): Promise<EngineQueryResult> {
    if (this.control.stopRequested) {
      return { status: "rejected", error: workspaceUnavailable("Engine is stopping") };
    }
    let parsed: EngineQuery;
    try {
      parsed = parseEngineQuery(query);
    } catch (error) {
      return { status: "rejected", error: invalidInput(error) };
    }
    const resident = this.residents.get(parsed.workspaceId);
    if (!resident) {
      return { status: "rejected", error: workspaceNotFound(parsed.workspaceId) };
    }
    try {
      return { status: "ok", value: await resident.workspace.query(parsed) };
    } catch (error) {
      return {
        status: "rejected",
        error: {
          code: "projection-unavailable",
          message: error instanceof Error ? error.message : String(error),
          currentGenerationId: null,
        },
      };
    }
  }

  private assertAbsent(workspaceId: string): void {
    if (this.residents.has(workspaceId)) {
      throw new Error(`Workspace ${workspaceId} already exists`);
    }
  }

  private assertRunning(): void {
    if (this.control.stopRequested) {
      throw new Error("Workspace subsystem is stopping");
    }
  }

  private resident(workspaceId: string): WorkspaceRegistryEntry {
    const resident = this.residents.get(workspaceId);
    if (!resident) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
    return resident;
  }
}
