import type { EditAction } from "../../../domain/edit/index.js";
import { assertAuthoredIntent } from "../../../domain/authored-intent/index.js";
import { type ActorId, type EditIntent, type FactSnapshot, type ReplicaId } from "../../../domain/fact/index.js";
import type { InterpretedProjectionGeneration } from "../../../domain/reconcile/index.js";
import { planEditAction } from "./edit-action-planning.js";
import { expandGraphAction } from "./graph-action-expansion.js";
import { requireAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";
import { createProspectiveFactProgram } from "./prospective-fact-program.js";

export { EditPlanningRejection } from "./planning-rejection.js";

type EditPlanningInput = Readonly<{
  workspaceId: string;
  actorId: ActorId;
  edits: readonly EditAction[];
  generation: InterpretedProjectionGeneration;
  intent: EditIntent;
  snapshot: FactSnapshot;
  replicaId: ReplicaId;
}>;

export function prepareEdits(input: EditPlanningInput): readonly AuthoredActionBatch[] {
  const { workspaceId, actorId, edits, generation, intent, snapshot, replicaId } = input;
  let workingGeneration = generation;
  const prepared: AuthoredActionBatch[] = [];
  const program = createProspectiveFactProgram({
    workspaceId,
    actorId,
    intent,
    snapshot,
    versions: generation.identity,
    replicaId,
  });
  for (const edit of edits) {
    const available = workingGeneration.review;
    const previous = intent === "direct" ? workingGeneration.origin : available;
    const planned = planEditAction(edit, available, (actionIndex) => program.finalActionId(actionIndex));
    const batch = requireAuthoredActionBatch(planned.flatMap((action) => expandGraphAction(action, available)));
    const prospective = program.appendBatch(batch);
    for (const action of batch) {
      assertAuthoredIntent(action, { previous, available, resulting: prospective.generation.review });
    }
    prepared.push(batch);
    workingGeneration = prospective.generation;
  }
  return prepared;
}
