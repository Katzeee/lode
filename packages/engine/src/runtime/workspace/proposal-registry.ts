import type {
  EngineCommand,
  EngineContract,
  EngineError,
  EngineEvent,
  EngineQuery,
  EngineQueryResult,
  Unsubscribe,
  WriteResult,
} from "../../application/contract.js";
import type { WorkspaceApplication } from "../../application/engine-contract.js";
import { parseEngineCommand, parseEngineQuery } from "../../application/input-validation.js";
import { deliverListeners } from "../../application/event-delivery.js";

export class ProposalWorkspaceRegistry {
  private readonly workspaces = new Map<string, WorkspaceApplication>();
  private readonly workspaceSubscriptions = new Map<string, Unsubscribe>();
  private readonly listeners = new Set<(event: EngineEvent) => void>();

  readonly contract: EngineContract = {
    execute: (command) => this.execute(command),
    query: (query) => this.query(query),
    subscribe: (listener) => this.subscribe(listener),
  };

  register(workspace: WorkspaceApplication): void {
    if (this.workspaces.has(workspace.workspaceId)) {
      throw new Error(`Workspace is already loaded: ${workspace.workspaceId}`);
    }
    this.workspaces.set(workspace.workspaceId, workspace);
    this.workspaceSubscriptions.set(
      workspace.workspaceId,
      workspace.subscribe((event) => {
        deliverListeners(this.listeners, event);
      }),
    );
  }

  unregister(workspaceId: string): boolean {
    this.workspaceSubscriptions.get(workspaceId)?.();
    this.workspaceSubscriptions.delete(workspaceId);
    return this.workspaces.delete(workspaceId);
  }

  has(workspaceId: string): boolean {
    return this.workspaces.has(workspaceId);
  }

  private execute(command: EngineCommand): Promise<WriteResult> {
    let parsed: EngineCommand;
    try {
      parsed = parseEngineCommand(command);
    } catch (error) {
      return Promise.resolve(invalidWrite(error));
    }
    const workspace = this.workspaces.get(parsed.workspaceId);
    return workspace
      ? workspace.execute(parsed)
      : Promise.resolve({ status: "rejected", error: notLoaded(parsed.workspaceId) });
  }

  private async query(query: EngineQuery): Promise<EngineQueryResult> {
    let parsed: EngineQuery;
    try {
      parsed = parseEngineQuery(query);
    } catch (error) {
      return { status: "rejected", error: invalidError(error) };
    }
    const workspace = this.workspaces.get(parsed.workspaceId);
    if (!workspace) {
      return { status: "rejected", error: notLoaded(parsed.workspaceId) };
    }
    try {
      return { status: "ok", value: await workspace.query(parsed) };
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

  private subscribe(listener: (event: EngineEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function invalidWrite(error: unknown): WriteResult {
  return { status: "rejected", error: invalidError(error) };
}

function invalidError(error: unknown): EngineError {
  return {
    code: "invalid-input",
    message: error instanceof Error ? error.message : String(error),
    currentGenerationId: null,
  };
}

function notLoaded(workspaceId: string): EngineError {
  return {
    code: "invalid-input",
    message: `Workspace is not loaded: ${workspaceId}`,
    currentGenerationId: null,
  };
}
