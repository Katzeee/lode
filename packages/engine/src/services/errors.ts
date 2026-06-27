// Engine-internal typed errors. These carry no wire/error-code knowledge — the daemon
// (Connect layer) maps them to Connect status codes + details. In-process callers (mobile)
// handle them directly. This keeps the engine free of the transport/RPC contract.
// (SessionRequiredError lives in session/session-manager.ts — co-located with its thrower,
// since session/ sits below services/ in the layer DAG.)

export class DocNotFoundError extends Error {
  readonly workspaceId: string;

  constructor(workspaceId: string) {
    super(`Doc not found for workspace: ${workspaceId}`);
    this.name = "DocNotFoundError";
    this.workspaceId = workspaceId;
  }
}
