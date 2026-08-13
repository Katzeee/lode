import {
  compareFacts,
  type ContributionFact,
  type Fact,
  type Mutation,
  type ResolutionFact,
  type ViewMode,
} from "../fact/index.js";
import { eligibleForView, resolutionsByContribution } from "./activation-view.js";
import { addSchemaMutationSupport, type SchemaSupportContext } from "./schema-support.js";
import {
  addGeneratedOccurrenceSupport,
  addInitializationSupport,
  addTemplateNodeSupport,
} from "./generated-relation-support.js";
import { addCandidate, addIfPresent, effectiveCandidate } from "./support-candidate.js";
import { addFieldContentDeletionSupport, isFieldContentDeletion } from "./field-content-support.js";
import { registerNodeExistence } from "./support-node-existence.js";
import {
  addMaterializedFieldSupport,
  addOccurrenceChangeSupport,
  addValueTargetSupport,
} from "./existence-mutation-support.js";

export type Activation = Readonly<{
  activeContributionIds: ReadonlySet<string>;
  supportByContribution: ReadonlyMap<string, readonly string[]>;
  resolutionByContribution: ReadonlyMap<string, readonly ResolutionFact[]>;
  convergencePasses: number;
}>;

export function deriveActivation(facts: readonly Fact[], mode: ViewMode): Activation {
  const ordered = [...facts].sort(compareFacts);
  const contributions = ordered.filter(
    (fact): fact is ContributionFact => fact.body.kind === "contribution",
  );
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
  const schemaTemplateOccurrenceSupport = new Map<string, ContributionFact[]>();
  const occurrenceLifecycleFacts = indexOccurrenceLifecycleFacts(ordered);
  const viable = new Set<string>();
  const existence = existenceSupport(nodeExistenceSupport, occurrenceExistenceSupport, viable);
  const schemaSupport = createSchemaSupport(
    nodeExistenceSupport,
    viable,
    schemaApplicationSupport,
    schemaTemplateOccurrenceSupport,
  );
  const result = new Map<string, readonly string[]>();
  const context = {
    nodeExistenceSupport,
    occurrenceExistenceSupport,
    viable,
    existence,
    schemaSupport,
    occurrenceLifecycleFacts,
  };

  registerNodeExistence(ordered, nodeExistenceSupport, eligibleContributionIds, viable);

  for (const fact of ordered) {
    const support = contributionSupport(fact, context);
    result.set(fact.id, [...support]);
    markViable(fact.id, support, eligibleContributionIds, viable);
  }
  return result;
}

function contributionSupport(
  fact: ContributionFact,
  context: Readonly<{
    nodeExistenceSupport: Map<string, string[]>;
    occurrenceExistenceSupport: Map<string, string[]>;
    viable: Set<string>;
    existence: ReturnType<typeof existenceSupport>;
    schemaSupport: SchemaSupportContext;
    occurrenceLifecycleFacts: ReadonlyMap<string, readonly ContributionFact[]>;
  }>,
): Set<string> {
  const { nodeExistenceSupport, occurrenceExistenceSupport, existence, schemaSupport } = context;
  const mutation = fact.body.mutation;
  const support = new Set<string>();
  if (isSchemaMutation(mutation)) {
    addSchemaContributionSupport(
      support,
      mutation,
      fact,
      schemaSupport,
      nodeExistenceSupport,
      occurrenceExistenceSupport,
    );
  } else if (mutation.kind === "template-node-detach") {
    addTemplateNodeSupport(support, mutation, fact, schemaSupport, existence);
  } else if (isFieldContentDeletion(mutation)) {
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

function addCoreMutationSupport(
  support: Set<string>,
  mutation: CoreSupportMutation,
  fact: ContributionFact,
  context: Parameters<typeof contributionSupport>[1],
): void {
  const { nodeExistenceSupport, occurrenceExistenceSupport, viable, existence, schemaSupport } =
    context;
  switch (mutation.kind) {
    case "node-create":
      break;
    case "node-delete":
    case "text-splice":
    case "text-mark":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
      break;
    case "node-restore":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
      support.add(mutation.deletionFactId);
      nodeExistenceSupport.set(mutation.nodeId, [fact.id]);
      break;
    case "occurrence-create":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
      addIfPresent(
        support,
        effectiveCandidate(nodeExistenceSupport, mutation.parentNodeId, viable),
      );
      addCandidate(occurrenceExistenceSupport, mutation.occurrenceId, fact.id);
      break;
    case "occurrence-delete":
    case "occurrence-move":
      addOccurrenceChangeSupport(
        support,
        occurrenceExistenceSupport,
        nodeExistenceSupport,
        viable,
        mutation,
      );
      break;
    case "occurrence-restore":
      addIfPresent(
        support,
        effectiveCandidate(occurrenceExistenceSupport, mutation.occurrenceId, viable),
      );
      support.add(mutation.deletionFactId);
      addIfPresent(
        support,
        effectiveCandidate(nodeExistenceSupport, mutation.parentNodeId, viable),
      );
      occurrenceExistenceSupport.set(mutation.occurrenceId, [fact.id]);
      break;
    case "node-owner-set":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.ownerNodeId, viable));
      break;
    case "field-materialize":
      addMaterializedFieldSupport(support, mutation, existence);
      break;
    case "field-initialize":
      addInitializationSupport(support, mutation, fact, schemaSupport, existence);
      break;
    case "value-set":
    case "value-unset":
      addValueTargetSupport(support, mutation, existence);
      break;
  }
}

type CoreSupportMutation = Exclude<
  Mutation,
  Extract<
    Mutation,
    {
      kind:
        | `schema-${string}`
        | "template-node-detach"
        | "field-value-delete"
        | "materialized-field-delete";
    }
  >
>;

function addSchemaContributionSupport(
  support: Set<string>,
  mutation: Extract<Mutation, { kind: `schema-${string}` }>,
  fact: ContributionFact,
  schemaSupport: SchemaSupportContext,
  nodeExistence: Map<string, string[]>,
  occurrenceExistence: Map<string, string[]>,
): void {
  addSchemaMutationSupport(support, mutation, fact, schemaSupport);
  if (mutation.kind === "schema-field-add") {
    addIfPresent(
      support,
      effectiveCandidate(nodeExistence, mutation.fieldNodeId, schemaSupport.viable),
    );
    addIfPresent(
      support,
      effectiveCandidate(occurrenceExistence, mutation.fieldOccurrenceId, schemaSupport.viable),
    );
  } else if (mutation.kind === "schema-template-node-add") {
    addIfPresent(
      support,
      effectiveCandidate(occurrenceExistence, mutation.templateOccurrenceId, schemaSupport.viable),
    );
  }
}

function existenceSupport(
  nodes: Map<string, string[]>,
  occurrences: Map<string, string[]>,
  viable: Set<string>,
) {
  return { nodes, occurrences, viable };
}

function createSchemaSupport(
  nodes: Map<string, string[]>,
  viable: Set<string>,
  applications: Map<string, ContributionFact[]>,
  templateOccurrences: Map<string, ContributionFact[]>,
): SchemaSupportContext {
  return { nodes, viable, applications, templateOccurrences };
}

function isSchemaMutation(
  mutation: Mutation,
): mutation is Extract<Mutation, { kind: `schema-${string}` }> {
  return mutation.kind.startsWith("schema-");
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
