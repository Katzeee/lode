import {
  compareCausalOrder,
  factObserves,
  factActionsFromFacts,
  isFieldContentRemovalAction,
  isSupertagAction,
  isTemplateAction,
  type FactAction,
  type FactActionId,
  type Fact,
  type ResolutionFact,
  type SupertagAction,
  type ProjectionPerspective,
} from "../fact/index.js";
import { eligibleForPerspective, resolutionsByAction } from "./activation-perspective.js";
import { addSupertagActionSupport, type SupertagSupportContext } from "./supertag-support.js";
import { addGeneratedOccurrenceSupport, addTemplateNodeSupport } from "./generated-relation-support.js";
import { addCandidate } from "./support-candidate.js";
import { addFieldContentDeletionSupport } from "./field-content-support.js";
import { addCoreActionSupport } from "./core-action-support.js";
import { intrinsicNodeTypeSupportKey } from "./supertag-support.js";
import { indexSemanticValueFacts, semanticValueKey } from "./semantic-value-support.js";

type Activation = Readonly<{
  activeActionIds: ReadonlySet<FactActionId>;
  supportByAction: ReadonlyMap<FactActionId, readonly FactActionId[]>;
  resolutionByAction: ReadonlyMap<FactActionId, readonly ResolutionFact[]>;
}>;

export function deriveActivation(
  facts: readonly Fact[],
  mode: ProjectionPerspective,
  suppliedActions?: readonly FactAction[],
): Activation {
  const ordered = [...facts].sort(compareCausalOrder);
  const actions = suppliedActions ?? factActionsFromFacts(ordered);
  const resolutions = resolutionsByAction(ordered, actions);
  const eligibleByFact = new Map<string, boolean>();
  for (const action of actions) {
    const eligible = eligibleForPerspective(action, resolutions.get(action.id), mode);
    eligibleByFact.set(action.factId, (eligibleByFact.get(action.factId) ?? true) && eligible);
  }
  const initiallyEligible = new Set(
    actions.filter((action) => eligibleByFact.get(action.factId)).map((action) => action.id),
  );
  const supportByAction = deriveSupport(actions, initiallyEligible);
  const active = new Set(initiallyEligible);

  let convergencePasses = 0;
  let changed = true;
  while (changed) {
    convergencePasses += 1;
    if (convergencePasses > actions.length + 1) {
      throw new Error("Support closure exceeded its finite action bound");
    }
    changed = false;
    for (const action of actions) {
      if (!active.has(action.id)) {
        continue;
      }
      const supports = supportByAction.get(action.id) ?? [];
      if (supports.some((supportId) => !active.has(supportId))) {
        actions.filter((member) => member.factId === action.factId).forEach((member) => active.delete(member.id));
        changed = true;
      }
    }
  }

  return {
    activeActionIds: active,
    supportByAction,
    resolutionByAction: resolutions,
  };
}

export function deriveSupport(
  actions: readonly FactAction[],
  eligibleActionIds: ReadonlySet<FactActionId> = new Set(actions.map((fact) => fact.id)),
): ReadonlyMap<FactActionId, readonly FactActionId[]> {
  const ordered = [...actions].sort(compareCausalOrder);
  let viable = new Set<FactActionId>();
  for (let pass = 0; pass <= ordered.length; pass += 1) {
    const derived = deriveSupportPass(ordered, eligibleActionIds, viable);
    if (derived.viable.size === viable.size) {
      return derived.supportByAction;
    }
    viable = derived.viable;
  }
  throw new Error("Support derivation exceeded its finite action bound");
}

function deriveSupportPass(
  ordered: readonly FactAction[],
  eligibleActionIds: ReadonlySet<FactActionId>,
  previouslyViable: ReadonlySet<FactActionId>,
): Readonly<{
  supportByAction: Map<FactActionId, readonly FactActionId[]>;
  viable: Set<FactActionId>;
}> {
  const nodeExistenceSupport = new Map<string, string[]>();
  const occurrenceExistenceSupport = new Map<string, string[]>();
  const supertagApplicationSupport = new Map<string, FactAction[]>();
  const supertagTemplateOccurrenceSupport = new Map<string, FactAction[]>();
  const templateFieldSupport = new Map<string, FactAction[]>();
  const optionalFieldSupport = new Map<string, FactAction[]>();
  const intrinsicNodeTypeSupport = new Map<string, string[]>();
  const occurrenceLifecycleFacts = indexOccurrenceLifecycleFacts(ordered);
  const inlineReferenceSupport = new Map<string, string[]>();
  const inlineAliasSupport = new Map<string, string[]>();
  const semanticValueSupport = indexSemanticValueFacts(ordered);
  const viable = new Set(previouslyViable);
  const existence = existenceSupport(nodeExistenceSupport, occurrenceExistenceSupport, viable);
  const supertagSupport = createSupertagSupport(
    nodeExistenceSupport,
    viable,
    supertagApplicationSupport,
    supertagTemplateOccurrenceSupport,
    templateFieldSupport,
    optionalFieldSupport,
    intrinsicNodeTypeSupport,
  );
  const result = new Map<FactActionId, readonly FactActionId[]>();
  const context = {
    nodeExistenceSupport,
    occurrenceExistenceSupport,
    viable,
    existence,
    supertagSupport,
    occurrenceLifecycleFacts,
    inlineReferenceSupport,
    inlineAliasSupport,
    semanticValueSupport,
  };

  registerIdentityProducers(
    ordered,
    nodeExistenceSupport,
    occurrenceExistenceSupport,
    inlineReferenceSupport,
    inlineAliasSupport,
    intrinsicNodeTypeSupport,
  );

  for (const fact of ordered) {
    const support = actionSupport(fact, context);
    result.set(fact.id, [...support]);
    markViable(fact.id, support, eligibleActionIds, viable);
  }
  return { supportByAction: result, viable };
}

function registerIdentityProducers(
  actions: readonly FactAction[],
  nodes: Map<string, string[]>,
  occurrences: Map<string, string[]>,
  inlineReferences: Map<string, string[]>,
  inlineAliases: Map<string, string[]>,
  intrinsicNodeTypes: Map<string, string[]>,
): void {
  for (const action of actions) {
    const authoredAction = action.action;
    if (authoredAction.kind === "workspace-bootstrap") {
      addCandidate(nodes, authoredAction.workspaceNodeId, action.id);
    } else if (authoredAction.kind === "node-create") {
      addCandidate(nodes, authoredAction.nodeId, action.id);
      if (authoredAction.originalPlacement !== null) {
        addCandidate(occurrences, authoredAction.originalPlacement.placementId, action.id);
      }
      if (authoredAction.intrinsicNodeType !== undefined) {
        addCandidate(
          intrinsicNodeTypes,
          intrinsicNodeTypeSupportKey(authoredAction.nodeId, authoredAction.intrinsicNodeType),
          action.id,
        );
      }
    } else if (authoredAction.kind === "placement-create") {
      addCandidate(occurrences, authoredAction.placementId, action.id);
    } else if (authoredAction.kind === "template-field-add" && authoredAction.fieldDefinition.kind === "new") {
      addCandidate(nodes, authoredAction.fieldDefinition.fieldDefinitionId, action.id);
      addCandidate(
        intrinsicNodeTypes,
        intrinsicNodeTypeSupportKey(authoredAction.fieldDefinition.fieldDefinitionId, "field-definition"),
        action.id,
      );
    } else if (authoredAction.kind === "inline-reference-create") {
      addCandidate(inlineReferences, authoredAction.inlineReferenceId, action.id);
    } else if (authoredAction.kind === "inline-alias-attach") {
      addCandidate(inlineAliases, `${authoredAction.inlineReferenceId}/${authoredAction.aliasNodeId}`, action.id);
    }
  }
}

function actionSupport(
  fact: FactAction,
  context: Readonly<{
    nodeExistenceSupport: Map<string, string[]>;
    occurrenceExistenceSupport: Map<string, string[]>;
    viable: Set<FactActionId>;
    existence: ReturnType<typeof existenceSupport>;
    supertagSupport: SupertagSupportContext;
    occurrenceLifecycleFacts: ReadonlyMap<string, readonly FactAction[]>;
    inlineReferenceSupport: Map<string, string[]>;
    inlineAliasSupport: Map<string, string[]>;
    semanticValueSupport: ReadonlyMap<string, readonly FactAction[]>;
  }>,
): Set<FactActionId> {
  const { existence, supertagSupport } = context;
  const authoredAction = fact.action;
  const support = new Set<FactActionId>();
  const semanticKey = semanticValueKey(authoredAction);
  if (semanticKey !== null) {
    for (const candidate of context.semanticValueSupport.get(semanticKey) ?? []) {
      if (candidate.id !== fact.id && factObserves(fact, candidate)) {
        support.add(candidate.id);
      }
    }
  }
  if (isSupertagAction(authoredAction)) {
    addSupertagContributionSupport(support, authoredAction, fact, supertagSupport);
  } else if (isTemplateAction(authoredAction)) {
    addTemplateNodeSupport(support, authoredAction, fact, supertagSupport, existence);
  } else if (isFieldContentRemovalAction(authoredAction)) {
    addFieldContentDeletionSupport(support, authoredAction, existence);
  } else {
    addCoreActionSupport(support, authoredAction, context);
  }
  addGeneratedOccurrenceSupport(support, authoredAction, fact, context.occurrenceLifecycleFacts);
  return support;
}

function indexOccurrenceLifecycleFacts(facts: readonly FactAction[]): ReadonlyMap<string, readonly FactAction[]> {
  const result = new Map<string, FactAction[]>();
  for (const fact of facts) {
    const authoredAction = fact.action;
    if (authoredAction.kind !== "placement-create" && authoredAction.kind !== "placement-remove") {
      continue;
    }
    const key = `${authoredAction.kind}/${authoredAction.placementId}`;
    const candidates = result.get(key) ?? [];
    candidates.push(fact);
    result.set(key, candidates);
  }
  return result;
}

function addSupertagContributionSupport(
  support: Set<string>,
  authoredAction: SupertagAction,
  fact: FactAction,
  supertagSupport: SupertagSupportContext,
): void {
  addSupertagActionSupport(support, authoredAction, fact, supertagSupport);
}

function existenceSupport(nodes: Map<string, string[]>, occurrences: Map<string, string[]>, viable: Set<string>) {
  return { nodes, occurrences, viable };
}

function createSupertagSupport(
  nodes: Map<string, string[]>,
  viable: Set<string>,
  applications: Map<string, FactAction[]>,
  templateOccurrences: Map<string, FactAction[]>,
  templateFields: Map<string, FactAction[]>,
  optionalFields: Map<string, FactAction[]>,
  intrinsicNodeTypeDeclarations: Map<string, string[]>,
): SupertagSupportContext {
  return {
    nodes,
    viable,
    applications,
    templateOccurrences,
    templateFields,
    optionalFields,
    intrinsicNodeTypeDeclarations,
  };
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
