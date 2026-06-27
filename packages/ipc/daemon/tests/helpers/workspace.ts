import type { AppServerClient, LodeCommandsClient } from "@lode/client";

export const TEST_WORKSPACE_ID = "ws_main";

// A LodeCommandsClient whose calls default workspaceId to TEST_WORKSPACE_ID when the
// caller omits it. (There is one doc per workspace now, so doc-scoped calls need only
// workspaceId.) Extra fields on workspace-scoped RPCs are ignored by protobuf's create.
export type TestRpc = LodeCommandsClient;

export async function createTestWorkspaceAndDoc(client: AppServerClient): Promise<void> {
  await client.rpc.createWorkspace({
    workspaceId: TEST_WORKSPACE_ID,
    displayName: "Test Workspace",
  });
  await client.rpc.createWorkspaceDoc({
    workspaceId: TEST_WORKSPACE_ID,
    docId: "main",
    displayName: "Main",
  });
}

export function withDefaultWorkspace(client: AppServerClient): TestRpc {
  return withDefaultWorkspaceRpc(client.rpc, TEST_WORKSPACE_ID);
}

// Wraps an rpc client so any DOC-SCOPED call without a workspaceId injects the
// default workspace (one doc per workspace now, so doc-scoped calls need only it).
// Workspace-lifecycle RPCs (create/removeWorkspace, *WorkspaceDoc, listWorkspaceDocs)
// pass through unchanged — injecting workspaceId there would, e.g., force a
// server-generated workspace id to the default.
const WORKSPACE_LIFECYCLE_METHODS = new Set([
  "createWorkspace",
  "removeWorkspace",
  "listWorkspaces",
  "createWorkspaceDoc",
  "removeWorkspaceDoc",
  "listWorkspaceDocs",
]);
export function withDefaultWorkspaceRpc(rpc: LodeCommandsClient, workspaceId: string): TestRpc {
  return new Proxy<LodeCommandsClient>(rpc, {
    get(target, prop) {
      const value = target[prop as keyof LodeCommandsClient];
      if (typeof value !== "function") {
        return value;
      }
      return (init?: Record<string, unknown>) => {
        const isLifecycle = typeof prop === "string" && WORKSPACE_LIFECYCLE_METHODS.has(prop);
        const merged =
          init !== undefined && !isLifecycle && !("workspaceId" in init)
            ? { ...init, workspaceId }
            : init;
        return (value as (init?: unknown) => unknown).call(target, merged);
      };
    },
  });
}
