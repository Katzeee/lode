import type { Engine, NodeId } from "../../core/index.js";
import type { ResolvedCaller } from "../../runtime/identity/caller.js";
import { Committed } from "../../runtime/workspace/workspace-facts.js";
import type { CommandDeps } from "./context.js";

// Runs a mutating engine operation within the commit/event envelope:
// authenticate → acquire workspace lease + exclusive lane → pin → mutate (capturing effects) →
// flush → publish the effects as a committed fact. core RETURNS what changed via captureEffects;
// the bridge that once subscribed to an engine Subject is gone.
export async function runMutation<T>(
  ctx: CommandDeps,
  caller: ResolvedCaller,
  workspaceId: string,
  operation: (engine: Engine) => T | Promise<T>,
  workingSet?: (engine: Engine) => readonly NodeId[],
): Promise<T> {
  return ctx.workspaces.runWorkspaceExclusive(workspaceId, async (workspace) => {
    const engine = workspace.engine;
    const outliner = engine.asOutliner();
    const resident = workingSet?.(engine) ?? [];
    let pinned = false;
    if (resident.length > 0) {
      await outliner.ensureResident(resident);
      pinned = true;
    }
    try {
      const { result, effects } = await engine.captureEffects(() => operation(engine));
      await workspace.flush();
      if (effects.length > 0) {
        workspace.facts.emit(new Committed(workspaceId, caller.origin, effects));
      }
      return result;
    } finally {
      if (pinned) {
        outliner.release();
      }
    }
  });
}
