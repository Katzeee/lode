import {
  compareFacts,
  isFieldContentDeletionMutation,
  isSupertagMutation,
  isTemplateMutation,
  type ContributionFact,
  type Fact,
  type ResolutionFact,
  type SupertagMutation,
  type ProjectionPerspective,
} from "../fact/index.js";
import { eligibleForPerspective, resolutionsByContribution } from "./activation-perspective.js";
import { addSupertagMutationSupport, type SupertagSupportContext } from "./supertag-support.js";
import { addGeneratedOccurrenceSupport, addTemplateNodeSupport } from "./generated-relation-support.js";
import { addIfPresent, effectiveCandidate } from "./support-candidate.js";
import { addFieldContentDeletionSupport } from "./field-content-support.js";
import { registerNodeExistence } from "./support-node-existence.js";
import { addCoreMutationSupport } from "./core-mutation-support.js";
import { addTransactionSupport } from "./transaction-support.js";

export type Activation = Readonly<{
  activeContributionIds: ReadonlySet<string>;
  supportByContribution: ReadonlyMap<string, readonly string[]>;
  resolutionByContribution: ReadonlyMap<string, readonly ResolutionFact[]>;
  convergencePasses: number;
}>;

export function deriveActivation(facts: readonly Fact[], mode: ProjectionPerspective): Activation {
  const ordered = [...facts].sort(compareFacts);
  const contributions = ordered.filter((fact): fact is ContributionFact => fact.body.kind === "contribution");
  const resolutions = resolutionsByContribution(ordered);
  const initiallyEligible = new Set(
    contributions.filter((fact) => eligibleForPerspective(fact, resolutions.get(fact.id), mode)).map((fact) => fact.id),
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
  const supertagApplicationSupport = new Map<string, ContributionFact[]>();
  const supertagTemplateOccurrenceSupport = new Map<string, ContributionFact[]>();
  const intrinsicNodeTypeSupport = new Map<string, string[]>();
  const occurrenceLifecycleFacts = indexOccurrenceLifecycleFacts(ordered);
  const inlineReferenceSupport = new Map<string, string[]>();
  const inlineAliasSupport = new Map<string, string[]>();
  const viable = new Set<string>();
  const existence = existenceSupport(nodeExistenceSupport, occurrenceExistenceSupport, viable);
  const supertagSupport = createSupertagSupport(
    nodeExistenceSupport,
    viable,
    supertagApplicationSupport,
    supertagTemplateOccurrenceSupport,
    intrinsicNodeTypeSupport,
  );
  const result = new Map<string, readonly string[]>();
  const context = {
    nodeExistenceSupport,
    occurrenceExistenceSupport,
    viable,
    existence,
    supertagSupport,
    occurrenceLifecycleFacts,
    inlineReferenceSupport,
    inlineAliasSupport,
  };

  registerNodeExistence(ordered, nodeExistenceSupport, eligibleContributionIds, viable);

  for (const fact of ordered) {
    const support = contributionSupport(fact, context);
    result.set(fact.id, [...support]);
    markViable(fact.id, support, eligibleContributionIds, viable);
  }
  addTransactionSupport(ordered, result);
  return result;
}

function contributionSupport(
  fact: ContributionFact,
  context: Readonly<{
    nodeExistenceSupport: Map<string, string[]>;
    occurrenceExistenceSupport: Map<string, string[]>;
    viable: Set<string>;
    existence: ReturnType<typeof existenceSupport>;
    supertagSupport: SupertagSupportContext;
    occurrenceLifecycleFacts: ReadonlyMap<string, readonly ContributionFact[]>;
    inlineReferenceSupport: Map<string, string[]>;
    inlineAliasSupport: Map<string, string[]>;
  }>,
): Set<string> {
  const { occurrenceExistenceSupport, existence, supertagSupport } = context;
  const mutation = fact.body.mutation;
  const support = new Set<string>();
  if (isSupertagMutation(mutation)) {
    addSupertagContributionSupport(support, mutation, fact, supertagSupport, occurrenceExistenceSupport);
  } else if (isTemplateMutation(mutation)) {
    addTemplateNodeSupport(support, mutation, fact, supertagSupport, existence);
  } else if (isFieldContentDeletionMutation(mutation)) {
    addFieldContentDeletionSupport(support, mutation, existence);
  } else {
    addCoreMutationSupport(support, mutation, fact, context);
  }
  addGeneratedOccurrenceSupport(support, mutation, fact, context.occurrenceLifecycleFacts);
  return support;
}

function indexOccurrenceLifecycleFacts(
  facts: readonly ContributionFact[],
): ReadonlyMap<string, readonly ContributionFact[]> {
  const result = new Map<string, ContributionFact[]>();
  for (const fact of facts) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "occurrence-create" && mutation.kind !== "occurrence-delete") {
      continue;
    }
    const key = `${mutation.kind}/${mutation.occurrenceId}`;
    const candidates = result.get(key) ?? [];
    candidates.push(fact);
    result.set(key, candidates);
  }
  return result;
}

function addSupertagContributionSupport(
  support: Set<string>,
  mutation: SupertagMutation,
  fact: ContributionFact,
  supertagSupport: SupertagSupportContext,
  occurrenceExistence: Map<string, string[]>,
): void {
  addSupertagMutationSupport(support, mutation, fact, supertagSupport);
  if (mutation.kind === "supertag-template-node-add") {
    addIfPresent(
      support,
      effectiveCandidate(occurrenceExistence, mutation.templateOccurrenceId, supertagSupport.viable),
    );
  }
}

function existenceSupport(nodes: Map<string, string[]>, occurrences: Map<string, string[]>, viable: Set<string>) {
  return { nodes, occurrences, viable };
}

function createSupertagSupport(
  nodes: Map<string, string[]>,
  viable: Set<string>,
  applications: Map<string, ContributionFact[]>,
  templateOccurrences: Map<string, ContributionFact[]>,
  intrinsicNodeTypeDeclarations: Map<string, string[]>,
): SupertagSupportContext {
  return { nodes, viable, applications, templateOccurrences, intrinsicNodeTypeDeclarations };
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
