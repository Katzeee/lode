import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { ApplicationHost } from "../session/contract.js";
import { WorkspaceController } from "./workspace-controller.js";

class WorkspaceControllers {
  private readonly entries = new Map<string, { controller: WorkspaceController; users: number; stop?: () => void }>();
  constructor(private readonly host: ApplicationHost) {}
  get(workspaceId: string, actorId: string) {
    const key = JSON.stringify([workspaceId, actorId]);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { controller: new WorkspaceController(this.host.engine, workspaceId, actorId), users: 0 };
      this.entries.set(key, entry);
    }
    return entry;
  }
  retain(workspaceId: string, actorId: string) {
    const entry = this.get(workspaceId, actorId);
    if (entry.users++ === 0) {
      const stop = entry.controller.start();
      const stopState = this.host.onStateChanged(entry.controller.reload);
      const beforeUnload = (event: BeforeUnloadEvent) => {
        const state = entry.controller.getSnapshot();
        if (state.drafts.size || state.pending) {
          event.preventDefault();
        }
      };
      window.addEventListener("focus", entry.controller.reload);
      window.addEventListener("beforeunload", beforeUnload);
      entry.stop = () => {
        stopState();
        stop();
        window.removeEventListener("focus", entry.controller.reload);
        window.removeEventListener("beforeunload", beforeUnload);
      };
    }
    return () => {
      if (--entry.users === 0) {
        entry.stop?.();
        entry.stop = undefined;
      }
    };
  }
}

const WorkspaceContext = createContext<WorkspaceControllers | null>(null);
export function WorkspaceEditingProvider({ host, children }: Readonly<{ host: ApplicationHost; children: ReactNode }>) {
  const pool = useMemo(() => new WorkspaceControllers(host), [host]);
  return <WorkspaceContext.Provider value={pool}>{children}</WorkspaceContext.Provider>;
}
export function useWorkspaceController(workspaceId: string, actorId: string, enabled = true): WorkspaceController {
  const pool = useContext(WorkspaceContext);
  if (!pool) {
    throw new Error("Workspace surfaces require WorkspaceEditingProvider");
  }
  const controller = pool.get(workspaceId, actorId).controller;
  useEffect(() => (enabled ? pool.retain(workspaceId, actorId) : undefined), [pool, workspaceId, actorId, enabled]);
  return controller;
}
