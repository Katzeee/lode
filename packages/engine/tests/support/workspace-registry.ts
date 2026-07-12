import { AppRuntime } from "../../src/runtime/kernel/app-runtime.js";
import type { RuntimeInstance } from "../../src/runtime/kernel/runtime.js";
import {
  WorkspaceRegistry,
  type PersistenceOptions,
} from "../../src/runtime/workspace/registry.js";

type TestControls = {
  close(): Promise<void>;
  crashClose(): Promise<void>;
};

export type TestWorkspaceRegistry = WorkspaceRegistry & TestControls;

export const TestWorkspaceRegistry = {
  inMemory: (): Promise<TestWorkspaceRegistry> =>
    open((instance) => WorkspaceRegistry.inMemory(instance)),
  persistent: (options: PersistenceOptions): Promise<TestWorkspaceRegistry> =>
    open((instance) => WorkspaceRegistry.persistent(options, instance)),
};

async function open(
  create: (instance: RuntimeInstance) => Promise<WorkspaceRegistry>,
): Promise<TestWorkspaceRegistry> {
  const app = new AppRuntime("workspace-test");
  const mounted = await app.root.mount("component:workspaces", create);
  await app.start();
  return Object.assign(mounted.api, {
    close: async () => void (await app.stop()),
    crashClose: async () => void (await app.stop({ checkpoint: false })),
  });
}
