import {
  compareFacts,
  type ContributionFact,
  type Fact,
  type Mutation,
  type ResolutionFact,
  type ViewMode,
} from "../fact/index.js";
import { addFieldInitializationSupport, addSchemaMutationSupport } from "./schema-support.js";

export type Activation = Readonly<{
  activeContributionIds: ReadonlySet<string>;
  supportByContribution: ReadonlyMap<string, readonly string[]>;
  resolutionByContribution: ReadonlyMap<string, readonly ResolutionFact[]>;
  convergencePasses: number;
}>;

export function deriveActivation(facts: readonly Fact[], mode: ViewMode): Activation {
  const ordered = [...facts].sort(compareFacts);
  const contributions = ordered.filter(isContribution);
  const resolutions = resolutionsByContribution(ordered);
  const initiallyEligible = new Set(
    contributions
      .filter((fact) => eligibleForView(fact, resolutions.get(fact.id), mode))
      .map((fact) => fact.id),
  );
  const supportByContribution = deriveSupport(contributions, initiallyEligible);
  const active = new Set(initiallyEligible);

  let convergencePasses = 0;
  let changed = true;
  while (changed) {
    convergencePasses += 1;
    if (convergencePasses > contributions.length + 1) {
      throw new Error("Support closure exceeded its finite contribution bound");
    }
    changed = false;
    for (const contributionId of [...active]) {
      const supports = supportByContribution.get(contributionId) ?? [];
      if (supports.some((supportId) => !active.has(supportId))) {
        active.delete(contributionId);
        changed = true;
      }
    }
  }

  return {
    activeContributionIds: active,
    supportByContribution,
    resolutionByContribution: resolutions,
    convergencePasses,
  };
}

export function deriveSupport(
  contributions: readonly ContributionFact[],
  eligibleContributionIds: ReadonlySet<string> = new Set(contributions.map((fact) => fact.id)),
): ReadonlyMap<string, readonly string[]> {
  const ordered = [...contributions].sort(compareFacts);
  const nodeExistenceSupport = new Map<string, string[]>();
  const occurrenceExistenceSupport = new Map<string, string[]>();
  const schemaApplicationSupport = new Map<string, ContributionFact[]>();
  const viable = new Set<string>();
  const existence = {
    nodes: nodeExistenceSupport,
    occurrences: occurrenceExistenceSupport,
    viable,
  };
  const schemaSupport = {
    nodes: nodeExistenceSupport,
    viable,
    applications: schemaApplicationSupport,
  };
  const result = new Map<string, readonly string[]>();

  for (const fact of ordered) {
    const mutation = fact.body.mutation;
    const support = new Set<string>();
    switch (mutation.kind) {
      case "node-create":
        addCandidate(nodeExistenceSupport, mutation.nodeId, fact.id);
        break;
      case "node-delete":
      case "text-splice":
      case "text-mark": {
        addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
        break;
      }
      case "node-restore": {
        addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
        support.add(mutation.deletionFactId);
        nodeExistenceSupport.set(mutation.nodeId, [fact.id]);
        break;
      }
      case "occurrence-create":
        addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
        if (mutation.parentOccurrenceId !== null && mutation.parentPolicy === "cascade") {
          addIfPresent(
            support,
            effectiveCandidate(occurrenceExistenceSupport, mutation.parentOccurrenceId, viable),
          );
        }
        addCandidate(occurrenceExistenceSupport, mutation.occurrenceId, fact.id);
        break;
      case "occurrence-delete":
      case "occurrence-move":
        addOccurrenceChangeSupport(support, occurrenceExistenceSupport, viable, mutation);
        break;
      case "occurrence-restore":
        addIfPresent(
          support,
          effectiveCandidate(occurrenceExistenceSupport, mutation.occurrenceId, viable),
        );
        support.add(mutation.deletionFactId);
        if (mutation.parentOccurrenceId !== null) {
          addIfPresent(
            support,
            effectiveCandidate(occurrenceExistenceSupport, mutation.parentOccurrenceId, viable),
          );
        }
        occurrenceExistenceSupport.set(mutation.occurrenceId, [fact.id]);
        break;
      case "canonical-occurrence-set":
        addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
        addIfPresent(
          support,
          effectiveCandidate(occurrenceExistenceSupport, mutation.occurrenceId, viable),
        );
        break;
      case "schema-apply":
      case "schema-remove":
      case "schema-field-add":
      case "schema-field-remove":
      case "schema-field-configure":
      case "schema-extension-add":
      case "schema-extension-remove":
        addSchemaMutationSupport(support, mutation, fact, schemaSupport);
        break;
      case "field-materialize":
        addMaterializedFieldSupport(support, mutation, existence);
        break;
      case "field-initialize":
        addFieldInitializationSupport(support, mutation, fact, schemaSupport);
        break;
      case "value-set":
      case "value-unset":
        addValueOwnerSupport(support, mutation, existence);
        break;
    }
    result.set(fact.id, [...support]);
    markViable(fact.id, support, eligibleContributionIds, viable);
  }
  return result;
}

function addValueOwnerSupport(
  support: Set<string>,
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
  existence: Readonly<{
    nodes: ReadonlyMap<string, readonly string[]>;
    occurrences: ReadonlyMap<string, readonly string[]>;
    viable: ReadonlySet<string>;
  }>,
): void {
  if (mutation.owner.kind === "node") {
    addIfPresent(support, effectiveCandidate(existence.nodes, mutation.owner.id, existence.viable));
  } else if (mutation.owner.kind === "occurrence") {
    addIfPresent(
      support,
      effectiveCandidate(existence.occurrences, mutation.owner.id, existence.viable),
    );
  }
}

function addOccurrenceChangeSupport(
  support: Set<string>,
  occurrenceSupport: ReadonlyMap<string, readonly string[]>,
  viable: ReadonlySet<string>,
  mutation: Extract<Mutation, { kind: "occurrence-delete" | "occurrence-move" }>,
): void {
  addIfPresent(support, effectiveCandidate(occurrenceSupport, mutation.occurrenceId, viable));
  if (mutation.kind === "occurrence-move" && mutation.parentOccurrenceId !== null) {
    addIfPresent(
      support,
      effectiveCandidate(occurrenceSupport, mutation.parentOccurrenceId, viable),
    );
  }
}

function addMaterializedFieldSupport(
  support: Set<string>,
  mutation: Extract<Mutation, { kind: "field-materialize" }>,
  existence: Readonly<{
    nodes: ReadonlyMap<string, readonly string[]>;
    occurrences: ReadonlyMap<string, readonly string[]>;
    viable: ReadonlySet<string>;
  }>,
): void {
  for (const nodeId of [mutation.ownerNodeId, mutation.fieldDefinitionId, mutation.fieldNodeId]) {
    addIfPresent(support, effectiveCandidate(existence.nodes, nodeId, existence.viable));
  }
  addIfPresent(
    support,
    effectiveCandidate(existence.occurrences, mutation.fieldOccurrenceId, existence.viable),
  );
}

export function supportClosure(
  targets: readonly string[],
  supportByContribution: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const closure = new Set(targets);
  const queue = [...targets];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const support of supportByContribution.get(current) ?? []) {
      if (closure.has(support)) {
        continue;
      }
      closure.add(support);
      queue.push(support);
    }
  }
  return [...closure].sort();
}

function resolutionsByContribution(
  facts: readonly Fact[],
): ReadonlyMap<string, readonly ResolutionFact[]> {
  const resolutions = new Map<string, ResolutionFact[]>();
  const superseded = new Set(
    facts.flatMap((fact) => (isResolution(fact) ? fact.body.adjudicatesResolutionIds : [])),
  );
  for (const fact of facts) {
    if (!isResolution(fact) || superseded.has(fact.id)) {
      continue;
    }
    for (const contributionId of fact.body.proposalContributionIds) {
      const current = resolutions.get(contributionId) ?? [];
      current.push(fact);
      resolutions.set(contributionId, current);
    }
  }
  return resolutions;
}

function eligibleForView(
  contribution: ContributionFact,
  resolutions: readonly ResolutionFact[] | undefined,
  mode: ViewMode,
): boolean {
  if (contribution.body.intent === "direct") {
    return true;
  }
  const decisions = new Set(resolutions?.map((resolution) => resolution.body.decision) ?? []);
  if (decisions.size > 1) {
    return mode === "review";
  }
  if (decisions.has("reject")) {
    return false;
  }
  if (decisions.has("accept")) {
    return true;
  }
  return mode === "review";
}

function isContribution(fact: Fact): fact is ContributionFact {
  return fact.body.kind === "contribution";
}

function isResolution(fact: Fact): fact is ResolutionFact {
  return fact.body.kind === "resolution";
}

function addIfPresent(target: Set<string>, value: string | undefined): void {
  if (value !== undefined) {
    target.add(value);
  }
}

function addCandidate(target: Map<string, string[]>, identity: string, factId: string): void {
  const candidates = target.get(identity) ?? [];
  candidates.push(factId);
  target.set(identity, candidates);
}

function effectiveCandidate(
  candidatesByIdentity: ReadonlyMap<string, readonly string[]>,
  identity: string,
  viable: ReadonlySet<string>,
): string | undefined {
  const candidates = candidatesByIdentity.get(identity);
  return candidates?.find((candidate) => viable.has(candidate)) ?? candidates?.[0];
}

function markViable(
  factId: string,
  support: ReadonlySet<string>,
  eligible: ReadonlySet<string>,
  viable: Set<string>,
): void {
  if (eligible.has(factId) && [...support].every((supportId) => viable.has(supportId))) {
    viable.add(factId);
  }
}
