import type { EngineEvent } from "../../application/contract.js";
import { deliverListeners } from "../../application/event-delivery.js";
import type { FactSnapshot } from "../../domain/fact/index.js";
import {
  advanceGeneration,
  type ProjectionGeneration,
  type ReconcileResult,
} from "../../domain/reconcile/index.js";
import type {
  ProjectionGenerationStore,
  ProposalWorkspaceOptions,
} from "./proposal-workspace-types.js";

export function freezePublishedGeneration<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    freezePublishedGeneration(child);
  }
  return value;
}

export function emitWorkspaceEvent(
  listeners: ReadonlySet<(event: EngineEvent) => void>,
  workspaceId: string,
  kind: EngineEvent["kind"],
  frontier: EngineEvent["frontier"],
  generationId: string | null,
): void {
  const event = freezePublishedGeneration({
    kind,
    workspaceId,
    frontier: { ...frontier },
    generationId,
  });
  deliverListeners(listeners, event);
}

export async function publicationStep<T>(task: Promise<T>, timeoutMs = 5_000): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Publication timeout must be a positive safe integer");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Projection publication timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function buildAndPublishGeneration(
  options: ProposalWorkspaceOptions,
  generations: ProjectionGenerationStore,
  publishedSnapshot: FactSnapshot,
  snapshot: FactSnapshot,
  previous: ProjectionGeneration,
): Promise<ReconcileResult> {
  const result = advanceGeneration(
    options.workspaceId,
    publishedSnapshot,
    snapshot,
    options.versions,
    previous,
  );
  const next = result.generation;
  if (options.publisher) {
    await publicationStep(options.publisher.publish(next), options.publicationTimeoutMs);
  }
  await publicationStep(generations.publish(next), options.publicationTimeoutMs);
  try {
    await options.checkpoints?.save(options.workspaceId, snapshot, next);
  } catch {
    /* Checkpoints accelerate restart and never participate in publication. */
  }
  return result;
}
