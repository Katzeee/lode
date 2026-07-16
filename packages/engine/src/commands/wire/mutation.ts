import type { Engine, NodeId, NodeUpdatedPayload } from "../../core/index.js";
import type { ResolvedCaller } from "../../runtime/identity/caller.js";
import { Committed } from "../../runtime/workspace/workspace-facts.js";
import type { CommandDeps } from "./context.js";

// Runs a mutating engine operation within the commit/event envelope:
// authenticate → acquire workspace exclusive lock → pin the working set → mutate (capturing effects)
// → release the working set → flush → publish the effects as a committed fact. core RETURNS what
// changed via captureEffects; the bridge that once subscribed to an engine Subject is gone.
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
    // Mutate inside the armed working-set session — the gate asserts the op touches only its declared
    // shards. flush + emit run AFTER the session is released: flush persists EVERY dirty shard,
    // including ones dirtied by PRIOR ops / sync rounds that this op did not declare in its working
    // set, so it must run off the gate. The exclusive lock is still held, so the flush stays
    // single-entry.
    let result!: T;
    let effects: NodeUpdatedPayload[];
    try {
      const captured = await engine.captureEffects(() => operation(engine));
      result = captured.result;
      effects = captured.effects;
    } finally {
      if (pinned) {
        outliner.release();
      }
    }
    await workspace.flush();
    if (effects.length > 0) {
      workspace.facts.emit(new Committed(workspaceId, caller.origin, effects));
    }
    return result;
  });
}
