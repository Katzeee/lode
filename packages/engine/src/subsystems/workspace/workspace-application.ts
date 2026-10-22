import type {
  EngineApplicationContract,
  EngineCommand,
  EngineQuery,
  EngineQueryForKind,
  EngineQueryInput,
  EngineQueryKind,
  EngineQueryResult,
  WriteResult,
} from "@lode/sdk";
import { ProtocolInputValidationError } from "@lode/sdk/host";

import { ShapeValidationError } from "../../decoding/index.js";
import type { Workspace } from "./workspace.js";
import { parseEngineCommand, parseEngineQuery, type AcceptedEngineCommand } from "./application/input-validation.js";
import { invalidInput, invalidWrite, workspaceNotFound, workspaceUnavailable } from "./workspace-errors.js";

type WorkspaceApplication = Pick<EngineApplicationContract, "execute" | "query">;
type WorkspaceApplicationOptions = Readonly<{
  resolve(workspaceId: string): Workspace | undefined;
  stopRequested(): boolean;
}>;

export function createWorkspaceApplication(options: WorkspaceApplicationOptions): WorkspaceApplication {
  return {
    execute: (command) => executeWorkspaceCommand(options, command),
    query: (query) => queryWorkspace(options, query),
  };
}

function executeWorkspaceCommand(options: WorkspaceApplicationOptions, command: EngineCommand): Promise<WriteResult> {
  if (options.stopRequested()) {
    return Promise.resolve({ status: "rejected", error: workspaceUnavailable("Engine is stopping") });
  }
  let parsed: AcceptedEngineCommand;
  try {
    parsed = parseEngineCommand(command);
  } catch (error) {
    if (expectedInputFailure(error)) {
      return Promise.resolve(invalidWrite(error));
    }
    throw error;
  }
  const workspace = options.resolve(parsed.workspaceId);
  return workspace
    ? workspace.executeAccepted(parsed)
    : Promise.resolve({ status: "rejected", error: workspaceNotFound(parsed.workspaceId) });
}

function queryWorkspace<Kind extends EngineQueryKind>(
  options: WorkspaceApplicationOptions,
  query: EngineQueryInput<Kind>,
): Promise<EngineQueryResult<EngineQueryForKind<Kind>>>;
async function queryWorkspace(options: WorkspaceApplicationOptions, query: EngineQuery): Promise<EngineQueryResult> {
  if (options.stopRequested()) {
    return { status: "rejected", error: workspaceUnavailable("Engine is stopping") };
  }
  let parsed: EngineQuery;
  try {
    parsed = parseEngineQuery(query);
  } catch (error) {
    if (expectedInputFailure(error)) {
      return { status: "rejected", error: invalidInput(error) };
    }
    throw error;
  }
  const workspace = options.resolve(parsed.workspaceId);
  if (!workspace) {
    return { status: "rejected", error: workspaceNotFound(parsed.workspaceId) };
  }
  return { status: "ok", value: await workspace.query(parsed) };
}

function expectedInputFailure(error: unknown): error is ProtocolInputValidationError | ShapeValidationError {
  return error instanceof ProtocolInputValidationError || error instanceof ShapeValidationError;
}
