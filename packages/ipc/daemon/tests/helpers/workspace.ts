import type { AppServerClient, LodeCommandsClient } from "@lode/client";

export const TEST_WORKSPACE_ID = "ws_main";

// A LodeCommandsClient whose calls default workspaceId to TEST_WORKSPACE_ID when the
// caller omits it. Extra fields on workspace-scoped RPCs are ignored by protobuf's create.
export type TestRpc = LodeCommandsClient;

export async function createTestWorkspace(client: AppServerClient): Promise<void> {
  await client.rpc.createWorkspace({
    workspaceId: TEST_WORKSPACE_ID,
    displayName: "Test Workspace",
  });
}

export function withDefaultWorkspace(client: AppServerClient): TestRpc {
  return withDefaultWorkspaceRpc(client.rpc, TEST_WORKSPACE_ID);
}

// Wraps an rpc client so any call without a workspaceId injects the default workspace.
// Workspace-lifecycle RPCs (create/remove/listWorkspaces) pass through unchanged — injecting
// workspaceId there would, e.g., force a server-generated workspace id to the default.
const WORKSPACE_LIFECYCLE_METHODS = new Set([
  "createWorkspace",
  "removeWorkspace",
  "listWorkspaces",
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
