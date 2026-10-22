import type { EngineError, WriteResult } from "@lode/sdk";

export function invalidWrite(error: unknown): WriteResult {
  return { status: "rejected", error: invalidInput(error) };
}

export function invalidInput(error: unknown): EngineError {
  return {
    code: "invalid-input",
    message: error instanceof Error ? error.message : String(error),
    currentGenerationId: null,
  };
}

export function workspaceNotFound(workspaceId: string): EngineError {
  return {
    code: "workspace-not-found",
    message: `Workspace does not exist: ${workspaceId}`,
    currentGenerationId: null,
  };
}

export function workspaceUnavailable(message: string): EngineError {
  return { code: "projection-unavailable", message, currentGenerationId: null };
}
