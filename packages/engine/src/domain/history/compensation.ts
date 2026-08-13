import {
  canonicalJson,
  compareFacts,
  type ContributionFact,
  type FactSnapshot,
  type Mutation,
} from "../fact/index.js";
import {
  rebuildGeneration,
  type Projection,
  type ProjectionGeneration,
} from "../reconcile/index.js";
import { deriveActivation } from "../reconcile/support.js";
import { compensateContentMutation } from "./compensation-content.js";
import {
  compensateNodeOwner,
  compensateMove,
  compensateNodeCreate,
  compensateNodeDelete,
  compensateOccurrenceCreate,
  compensateOccurrenceDelete,
} from "./compensation-structure.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";
import { compensateSchemaMutation } from "./compensation-schema.js";
import { scopedHistoryFacts } from "./compensation-scope.js";

export type Compensation =
  | Readonly<{ kind: "ready"; mutations: readonly Mutation[] }>
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{ kind: "stale"; reason: string }>;

export type HistoryPlanningObserver = (scope: Readonly<{ factCount: number }>) => void;

export function planCompensation(
  targetFacts: readonly ContributionFact[],
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  observer?: HistoryPlanningObserver,
): Compensation {
  const intent = targetFacts[0]?.body.intent;
  if (!intent || targetFacts.some((fact) => fact.body.intent !== intent)) {
    return { kind: "stale", reason: "History Step has inconsistent editing intent" };
  }
  const seedProjection = generation.review;
  const scopedFacts = scopedHistoryFacts(snapshot.facts, targetFacts, seedProjection);
  observer?.({ factCount: scopedFacts.length });
  const reviewActivation = deriveActivation(scopedFacts, "review");
  const eligibleTargets =
    intent === "proposal"
      ? targetFacts.filter((fact) => !reviewActivation.resolutionByContribution.has(fact.id))
      : [...targetFacts];
  if (eligibleTargets.length === 0) {
    return { kind: "unavailable", reason: "Terminal Proposal Contributions are not undoable" };
  }
  const originActivation = deriveActivation(scopedFacts, "origin");
  const contingentDirect =
    intent === "direct" &&
    eligibleTargets.some(
      (fact) =>
        reviewActivation.activeContributionIds.has(fact.id) &&
        !originActivation.activeContributionIds.has(fact.id),
    );
  const view = intent === "proposal" || contingentDirect ? "review" : "origin";
  const projection = generation[view];
  const active = view === "review" ? reviewActivation : originActivation;
  const eligibleIds = new Set(eligibleTargets.map((fact) => fact.id));
  const counterfactualFacts = scopedFacts.filter((fact) => !eligibleIds.has(fact.id));
  const firstTarget = eligibleTargets[0];
  if (!firstTarget) {
    return { kind: "unavailable", reason: "History Step has no target Facts" };
  }
  const versions = {
    rulesVersion: generation.identity.rulesVersion,
    schemaVersion: generation.identity.schemaVersion,
  };
  const scoped = rebuildGeneration(
    firstTarget.workspaceId,
    { facts: scopedFacts, frontier: snapshot.frontier },
    versions,
  ).generation[view];
  const counterfactual = rebuildGeneration(
    firstTarget.workspaceId,
    { facts: counterfactualFacts, frontier: snapshot.frontier },
    versions,
  ).generation[view];
  if (
    canonicalJson(semanticProjection(scoped)) === canonicalJson(semanticProjection(counterfactual))
  ) {
    return { kind: "unavailable", reason: "History Step has no attributable effect" };
  }
  const normalizedTargets = normalizeRepeatedOwners(eligibleTargets, projection);
  const normalizedIds = new Set(normalizedTargets.map((fact) => fact.id));
  const activeFacts = scopedFacts.filter(
    (fact): fact is ContributionFact =>
      fact.body.kind === "contribution" &&
      active.activeContributionIds.has(fact.id) &&
      (!eligibleIds.has(fact.id) || normalizedIds.has(fact.id)),
  );
  const mutations: Mutation[] = [];
  for (const target of [...normalizedTargets].reverse()) {
    if (!active.activeContributionIds.has(target.id)) {
      continue;
    }
    const planned = compensateMutation(target, eligibleIds, activeFacts, projection);
    if (planned.kind === "stale") {
      return planned;
    }
    mutations.push(...planned.mutations);
  }
  return mutations.length === 0
    ? { kind: "unavailable", reason: "History Step has no attributable effect" }
    : { kind: "ready", mutations };
}

function semanticProjection(
  projection: Projection,
): Omit<Projection, "reviewScopes" | "supportByContribution"> {
  const { reviewScopes: _reviewScopes, supportByContribution: _support, ...semantic } = projection;
  return semantic;
}

function normalizeRepeatedOwners(
  targets: readonly ContributionFact[],
  projection: Projection,
): readonly ContributionFact[] {
  const result: ContributionFact[] = [];
  const grouped = new Map<string, ContributionFact[]>();
  for (const target of targets) {
    const key = mutationOwnerKey(target.body.mutation);
    if (!key) {
      result.push(target);
      continue;
    }
    const group = grouped.get(key) ?? [];
    group.push(target);
    grouped.set(key, group);
  }
  for (const group of grouped.values()) {
    const ordered = [...group].sort(compareFacts);
    const first = ordered[0];
    const lifecycle = lifecycleRepresentatives(ordered, projection);
    if (lifecycle) {
      result.push(...lifecycle);
      continue;
    }
    const last = ordered.at(-1);
    if (!first || !last) {
      continue;
    }
    const firstMutation = first.body.mutation;
    const lastMutation = last.body.mutation;
    let mutation: Mutation = lastMutation;
    if (
      (firstMutation.kind === "value-set" || firstMutation.kind === "value-unset") &&
      (lastMutation.kind === "value-set" || lastMutation.kind === "value-unset")
    ) {
      mutation = { ...lastMutation, previous: firstMutation.previous };
    } else if (firstMutation.kind === "text-mark" && lastMutation.kind === "text-mark") {
      mutation = { ...lastMutation, previous: firstMutation.previous };
    } else if (
      firstMutation.kind === "occurrence-move" &&
      lastMutation.kind === "occurrence-move"
    ) {
      mutation = {
        ...lastMutation,
        previousParentNodeId: firstMutation.previousParentNodeId,
        previousAnchor: firstMutation.previousAnchor,
      };
    } else if (firstMutation.kind === "node-owner-set" && lastMutation.kind === "node-owner-set") {
      mutation = { ...lastMutation, previousOwnerNodeId: firstMutation.previousOwnerNodeId };
    }
    result.push({ ...last, body: { ...last.body, mutation } });
  }
  return result.sort(compareFacts);
}

function lifecycleRepresentatives(
  ordered: readonly ContributionFact[],
  projection: Projection,
): readonly ContributionFact[] | null {
  const mutation = ordered[0]?.body.mutation;
  if (!mutation) {
    return null;
  }
  if (
    mutation.kind === "node-create" ||
    mutation.kind === "node-delete" ||
    mutation.kind === "node-restore"
  ) {
    const wanted = projection.nodes[mutation.nodeId]
      ? ["node-create", "node-restore"]
      : ["node-delete"];
    const matching = ordered.filter((fact) => wanted.includes(fact.body.mutation.kind));
    return projection.nodes[mutation.nodeId] ? matching.slice(-1) : matching;
  }
  if (
    mutation.kind === "occurrence-create" ||
    mutation.kind === "occurrence-delete" ||
    mutation.kind === "occurrence-restore"
  ) {
    const wanted = projection.occurrences[mutation.occurrenceId]
      ? ["occurrence-create", "occurrence-restore"]
      : ["occurrence-delete"];
    const matching = ordered.filter((fact) => wanted.includes(fact.body.mutation.kind));
    return projection.occurrences[mutation.occurrenceId] ? matching.slice(-1) : matching;
  }
  return null;
}

function mutationOwnerKey(mutation: Mutation): string | null {
  if (
    mutation.kind === "node-create" ||
    mutation.kind === "node-delete" ||
    mutation.kind === "node-restore"
  ) {
    return `node-lifecycle/${mutation.nodeId}`;
  }
  if (
    mutation.kind === "occurrence-create" ||
    mutation.kind === "occurrence-delete" ||
    mutation.kind === "occurrence-restore"
  ) {
    return `occurrence-lifecycle/${mutation.occurrenceId}`;
  }
  if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
    return `value/${mutation.target.kind}/${mutation.target.id}/${mutation.namespace}/${mutation.key}`;
  }
  if (mutation.kind === "text-mark") {
    return `mark/${mutation.nodeId}/${mutation.key}/${[...mutation.atomIds].sort().join("|")}`;
  }
  if (mutation.kind === "occurrence-move") {
    return `move/${mutation.occurrenceId}`;
  }
  if (mutation.kind === "node-owner-set") {
    return `owner/${mutation.nodeId}`;
  }
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    return `schema-application/${mutation.nodeId}/${mutation.schemaId}`;
  }
  if (
    mutation.kind === "schema-field-add" ||
    mutation.kind === "schema-field-remove" ||
    mutation.kind === "schema-field-configure"
  ) {
    return `schema-field/${mutation.schemaId}/${mutation.fieldDefinitionId}`;
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    return `schema-extension/${mutation.schemaId}/${mutation.baseSchemaId}`;
  }
  return null;
}

function compensateMutation(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: Projection,
): CompensationStep {
  const content = compensateContentMutation(target, targetIds, activeFacts, projection);
  if (content) {
    return content;
  }
  switch (target.body.mutation.kind) {
    case "node-create":
    case "node-restore":
      return compensateNodeCreate(target, targetIds, activeFacts, projection);
    case "node-delete":
      return compensateNodeDelete(target, targetIds, activeFacts, projection);
    case "occurrence-create":
    case "occurrence-restore":
      return compensateOccurrenceCreate(target, targetIds, activeFacts, projection);
    case "occurrence-delete":
    case "field-value-delete":
    case "materialized-field-delete":
      return compensateOccurrenceDelete(target, targetIds, activeFacts, projection);
    case "occurrence-move":
      return compensateMove(target, activeFacts, projection);
    case "node-owner-set":
      return compensateNodeOwner(target, activeFacts, projection);
    case "schema-apply":
    case "schema-remove":
    case "schema-field-add":
    case "schema-field-remove":
    case "schema-field-configure":
    case "schema-extension-add":
    case "schema-extension-remove":
    case "schema-template-node-add":
    case "schema-template-node-remove":
      return compensateSchemaMutation(target, activeFacts, projection);
    case "text-splice":
    case "text-mark":
    case "value-set":
    case "value-unset":
    case "field-materialize":
    case "field-initialize":
    case "template-node-detach":
      return noCompensation();
  }
}
