import type {
  EngineCommand,
  EngineContract,
  EngineEvent,
  EngineQuery,
  EngineQueryValue,
  Unsubscribe,
  WriteResult,
} from "./contract.js";
import { parseEngineCommand, parseEngineQuery } from "./input-validation.js";

export type WorkspaceApplication = Readonly<{
  readonly workspaceId: string;
  execute(command: EngineCommand): Promise<WriteResult>;
  query(query: EngineQuery): Promise<EngineQueryValue>;
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe;
}>;

export function createEngineContract(workspaces: readonly WorkspaceApplication[]): EngineContract {
  const byId = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace]));
  return {
    execute(command) {
      let parsed: EngineCommand;
      try {
        parsed = parseEngineCommand(command);
      } catch (error) {
        return Promise.resolve({ status: "rejected", error: invalid(error) });
      }
      const workspace = byId.get(parsed.workspaceId);
      if (!workspace) {
        return Promise.resolve({
          status: "rejected",
          error: {
            code: "invalid-input",
            message: `Workspace is not loaded: ${parsed.workspaceId}`,
            currentGenerationId: null,
          },
        });
      }
      return workspace.execute(parsed);
    },
    async query(query) {
      let parsed: EngineQuery;
      try {
        parsed = parseEngineQuery(query);
      } catch (error) {
        return { status: "rejected", error: invalid(error) };
      }
      const workspace = byId.get(parsed.workspaceId);
      if (!workspace) {
        return {
          status: "rejected",
          error: {
            code: "invalid-input",
            message: `Workspace is not loaded: ${parsed.workspaceId}`,
            currentGenerationId: null,
          },
        };
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
    },
    subscribe(listener) {
      const unsubscribers = workspaces.map((workspace) => workspace.subscribe(listener));
      return () => {
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
      };
    },
  };
}

function invalid(error: unknown) {
  return {
    code: "invalid-input" as const,
    message: error instanceof Error ? error.message : String(error),
    currentGenerationId: null,
  };
}
