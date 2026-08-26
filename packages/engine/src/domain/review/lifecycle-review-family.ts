import { compareCausalOrder, templateInstanceNodeId, type FactAction } from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import { nodeLocation } from "../reconcile/node-graph.js";
import { addNodeReviewImpacts } from "./review-node-impact.js";
import type { HunkCandidate, ReviewEffectEntry, ReviewFamilyRule } from "./review-family.js";
import { addDefinitionLifecycleImpacts } from "./supertag-definition-impact.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import {
  isStructuralPlacementAction,
  actionAnchor,
  occurrenceIdsForNode,
  structuralOccurrenceId,
  structureEffect,
  structureEffectChanged,
} from "./structure-effect.js";

const LIFECYCLE_ACTION_KINDS = [
  "node-create",
  "node-trash",
  "node-restore",
  "original-promote",
  "template-node-detach",
] as const;

export const lifecycleReviewFamily = {
  key: "lifecycle",
  actionKinds: LIFECYCLE_ACTION_KINDS,
  scopes(fact) {
    const action = fact.action;
    if (!isLifecycleReviewAction(action)) {
      throw new Error("Lifecycle Review family received another AuthoredAction family");
    }
    if (action.kind === "template-node-detach") {
      return [
        reviewScope("template-detachment", action.ownerNodeId, action.templateNodeId),
        associatedNodeScope(action.ownerNodeId),
        associatedNodeScope(action.templateNodeId),
      ];
    }
    const nodeId = action.nodeId;
    const category = action.kind === "original-promote" ? "owner" : "lifecycle";
    return [reviewScope(category, nodeId), associatedNodeScope(nodeId)];
  },
  candidates: ({ generation, pending }) => lifecycleCandidates(generation, pending),
  effect(fact, _targets, generation) {
    const action = fact.action;
    if (!isLifecycleReviewAction(action)) {
      throw new Error("Lifecycle Review family received another AuthoredAction family");
    }
    return lifecycleEffect(fact, generation);
  },
  addImpacts(impacts, targets, generation) {
    for (const fact of targets) {
      const action = fact.action;
      if (!isLifecycleReviewAction(action)) {
        continue;
      }
      if ("nodeId" in action) {
        addNodeReviewImpacts(impacts, action.nodeId, generation);
        if (action.kind === "node-trash" || action.kind === "node-restore") {
          addDefinitionLifecycleImpacts(impacts, action.nodeId, generation);
        }
      }
      if (action.kind === "template-node-detach") {
        impacts.add(action.ownerNodeId);
        impacts.add(action.templateNodeId);
        for (const instance of templateInstances(generation)) {
          if (instance.ownerNodeId === action.ownerNodeId && instance.templateNodeId === action.templateNodeId) {
            impacts.add(instance.instanceOccurrenceId);
            if (instance.instanceNodeId !== null) {
              impacts.add(instance.instanceNodeId);
            }
          }
        }
      }
    }
  },
} satisfies ReviewFamilyRule;

function lifecycleCandidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<FactAction["id"], FactAction>,
): readonly HunkCandidate[] {
  const groups = new Map<string, FactAction[]>();
  for (const fact of pending.values()) {
    const action = fact.action;
    if (!isLifecycleReviewAction(action)) {
      continue;
    }
    const key =
      action.kind === "original-promote"
        ? `owner/${action.nodeId}`
        : `lifecycle/${"nodeId" in action ? action.nodeId : fact.id}`;
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((facts) => candidatesForGroup(facts, generation));
}

function candidatesForGroup(
  facts: readonly FactAction[],
  generation: ScopedProjectionGeneration,
): readonly HunkCandidate[] {
  if (!candidateHasEffect(facts, generation)) {
    return [];
  }
  const ordered = [...facts].sort(compareCausalOrder);
  const fact = ordered.at(-1);
  if (!fact) {
    return [];
  }
  const action = fact.action;
  const nodeImpacts =
    "nodeId" in action
      ? occurrenceIdsForNode(generation, action.nodeId)
      : action.kind === "template-node-detach"
        ? templateInstances(generation)
            .filter(
              (instance) =>
                instance.ownerNodeId === action.ownerNodeId && instance.templateNodeId === action.templateNodeId,
            )
            .map((instance) => instance.instanceOccurrenceId)
        : [];
  const identities = nodeImpacts.length > 0 ? nodeImpacts : [actionIdentity(fact)];
  return identities.map((identity) => ({
    diffSpace: {
      kind: action.kind === "original-promote" ? ("owner" as const) : ("lifecycle" as const),
      identity,
    },
    targets: ordered.map((target) => target.id),
    bridges: [],
  }));
}

function lifecycleEffect(fact: FactAction, generation: ScopedProjectionGeneration): ReviewEffectEntry | null {
  const action = fact.action;
  if (!isLifecycleReviewAction(action)) {
    return null;
  }
  if (action.kind === "original-promote") {
    const origin = generation.origin.nodeOwners[action.nodeId] ?? null;
    const review = generation.review.nodeOwners[action.nodeId] ?? null;
    return origin === review
      ? null
      : {
          identity: `owner/${action.nodeId}`,
          effect: { kind: "owner", identity: action.nodeId, origin, review },
        };
  }
  const identity = actionIdentity(fact);
  const origin = lifecyclePresence(generation.origin, identity);
  const review = lifecyclePresence(generation.review, identity);
  return origin === review
    ? null
    : {
        identity: `lifecycle/${identity}`,
        effect: { kind: "lifecycle", identity, origin, review },
      };
}

function lifecyclePresence(projection: ScopedProjectionGeneration["origin"], nodeId: string): boolean {
  return nodeLocation(projection.identity.workspaceNodeId, projection, nodeId) === "active";
}

function candidateHasEffect(facts: readonly FactAction[], generation: ScopedProjectionGeneration): boolean {
  return facts.some((fact) => {
    if (lifecycleEffect(fact, generation) !== null) {
      return true;
    }
    const action = fact.action;
    return (
      isStructuralPlacementAction(action) &&
      structureEffectChanged(structureEffect(structuralOccurrenceId(action), generation, actionAnchor(action)))
    );
  });
}

function actionIdentity(fact: FactAction): string {
  const action = fact.action;
  if ("nodeId" in action) {
    return action.nodeId;
  }
  if ("placementId" in action) {
    return action.placementId;
  }
  if (action.kind === "template-node-detach") {
    return templateInstanceNodeId(action.ownerNodeId, action.templateNodeId);
  }
  return fact.id;
}

function templateInstances(generation: ScopedProjectionGeneration) {
  return [...generation.origin.templateNodeInstances, ...generation.review.templateNodeInstances];
}

function isLifecycleReviewAction(action: FactAction["action"]): action is Extract<
  FactAction["action"],
  {
    kind: "node-create" | "node-trash" | "node-restore" | "original-promote" | "template-node-detach";
  }
> {
  return LIFECYCLE_ACTION_KINDS.includes(action.kind as (typeof LIFECYCLE_ACTION_KINDS)[number]);
}
