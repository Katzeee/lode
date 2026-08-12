import type { ContributionFact, FactSnapshot, ViewMode } from "../fact/index.js";
import { activeContributions } from "./projection-active.js";
import { applyText, applyValues } from "./projection-content.js";
import { createNodes } from "./projection-state.js";
import type { ProjectedNode, ProjectedOccurrence } from "./projection-types.js";
import { valueOwnerAddress } from "./value-address.js";

export function replayNodeIdentity(
  snapshot: FactSnapshot,
  view: ViewMode,
  nodeId: string,
): ProjectedNode | null {
  const active = activeContributions(snapshot, view).facts;
  const relevant = active.filter((fact) => mutationTouchesNode(fact, nodeId));
  const nodes = createNodes(relevant);
  const node = nodes.get(nodeId);
  if (!node) {
    return null;
  }
  applyText(relevant, nodes);
  const values = applyValues(relevant);
  return {
    ...node,
    properties: values[valueOwnerAddress({ kind: "node", id: nodeId }, "property")] ?? {},
    metadata: values[valueOwnerAddress({ kind: "node", id: nodeId }, "metadata")] ?? {},
  };
}

export function replayOccurrenceIdentity(
  snapshot: FactSnapshot,
  view: ViewMode,
  occurrenceId: string,
): Omit<ProjectedOccurrence, "parentOccurrenceId"> | null {
  const active = activeContributions(snapshot, view).facts;
  const create = active.find(
    (fact) =>
      fact.body.mutation.kind === "occurrence-create" &&
      fact.body.mutation.occurrenceId === occurrenceId,
  );
  if (create?.body.mutation.kind !== "occurrence-create") {
    return null;
  }
  const deletions = active.filter(
    (fact) =>
      fact.body.mutation.kind === "occurrence-delete" &&
      fact.body.mutation.occurrenceId === occurrenceId,
  );
  const restored = new Set(
    active.flatMap((fact) =>
      fact.body.mutation.kind === "occurrence-restore" &&
      fact.body.mutation.occurrenceId === occurrenceId
        ? [fact.body.mutation.deletionFactId]
        : [],
    ),
  );
  if (deletions.some((fact) => !restored.has(fact.id))) {
    return null;
  }
  const relevant = active.filter((fact) => {
    const mutation = fact.body.mutation;
    return (
      (mutation.kind === "value-set" || mutation.kind === "value-unset") &&
      mutation.owner.kind === "occurrence" &&
      mutation.owner.id === occurrenceId
    );
  });
  const values = applyValues(relevant);
  return {
    occurrenceId,
    nodeId: create.body.mutation.nodeId,
    properties:
      values[valueOwnerAddress({ kind: "occurrence", id: occurrenceId }, "property")] ?? {},
    metadata: values[valueOwnerAddress({ kind: "occurrence", id: occurrenceId }, "metadata")] ?? {},
    managed: false,
  };
}

function mutationTouchesNode(fact: ContributionFact, nodeId: string): boolean {
  const mutation = fact.body.mutation;
  if ("nodeId" in mutation && mutation.nodeId === nodeId) {
    return true;
  }
  return (
    (mutation.kind === "value-set" || mutation.kind === "value-unset") &&
    mutation.owner.kind === "node" &&
    mutation.owner.id === nodeId
  );
}
