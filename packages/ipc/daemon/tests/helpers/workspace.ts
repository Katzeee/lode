import type { AppServerClient, LodeCommandsClient } from "@lode/client";

export const TEST_WORKSPACE_ID = "ws_main";

// A LodeCommandsClient whose doc-scoped calls default workspaceId to TEST_WORKSPACE_ID
// when the caller omits it. Methods whose init has no docId pass through unchanged.
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

// Wraps an rpc client so any doc-scoped call (init has docId) without a workspaceId
// injects the default workspace. Used by tests that want to omit the boilerplate.
export function withDefaultWorkspaceRpc(rpc: LodeCommandsClient, workspaceId: string): TestRpc {
  return new Proxy<LodeCommandsClient>(rpc, {
    get(target, prop) {
      const value = target[prop as keyof LodeCommandsClient];
      if (typeof value !== "function") {
        return value;
      }
      return (init?: Record<string, unknown>) => {
        const merged =
          init !== undefined && "docId" in init && !("workspaceId" in init)
            ? { ...init, workspaceId }
            : init;
        return (value as (init?: unknown) => unknown).call(target, merged);
      };
    },
  });
}
