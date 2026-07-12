import { InMemoryDocStore } from "../../core/index.js";
import { workspaceDbPath } from "../../persistence/paths.js";
import { WorkspaceStore } from "../../persistence/workspace-store.js";
import { WorkspaceDocStore } from "./doc-store.js";
import type { WorkspaceContentOpener } from "./factory.js";

export function persistentContentOpener(dataRoot: string): WorkspaceContentOpener {
  return {
    open: async (record) => {
      const store = await WorkspaceStore.open(workspaceDbPath(dataRoot, record.relativePath));
      return { store, docStore: new WorkspaceDocStore(store) };
    },
  };
}

export function inMemoryContentOpener(): WorkspaceContentOpener {
  return {
    open: () => Promise.resolve({ store: null, docStore: new InMemoryDocStore() }),
  };
}
