import {
  actionIdentityProducers,
  compareCausalOrder,
  factActionContributions,
  factObserves,
  factActionsFromFacts,
  type FactAction,
  type FactActionId,
  type Fact,
  type ResolutionFact,
  type SemanticIdentity,
  type ProjectionPerspective,
} from "../fact/index.js";
import { eligibleForPerspective, resolutionsByAction } from "./activation-perspective.js";
import { addCausalCollectionSupport, type CausalCollectionSupportContext } from "./causal-collection-support.js";
import { addCandidate } from "./support-candidate.js";
import { addIdentityRequirementSupport, intrinsicNodeTypeSupportKey } from "./identity-support.js";
import { causalRegisterKeys, indexCausalRegisterFacts } from "./causal-register-support.js";

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
  const causalCollectionSupport: CausalCollectionSupportContext = new Map();
  const intrinsicNodeTypeSupport = new Map<string, string[]>();
  const occurrenceMaterializationFacts = indexOccurrenceMaterializationFacts(ordered);
  const inlineReferenceSupport = new Map<string, string[]>();
  const inlineAliasSupport = new Map<string, string[]>();
  const causalRegisterSupport = indexCausalRegisterFacts(ordered);
  const viable = new Set(previouslyViable);
  const result = new Map<FactActionId, readonly FactActionId[]>();
  const context = {
    nodeExistenceSupport,
    occurrenceExistenceSupport,
    viable,
    intrinsicNodeTypeSupport,
    causalCollectionSupport,
    occurrenceMaterializationFacts,
    inlineReferenceSupport,
    inlineAliasSupport,
    causalRegisterSupport,
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
  for (const fact of actions) {
    for (const identity of actionIdentityProducers(fact.action)) {
      registerIdentityProducer(
        identity,
        fact.id,
        nodes,
        occurrences,
        inlineReferences,
        inlineAliases,
        intrinsicNodeTypes,
      );
    }
  }
}

function registerIdentityProducer(
  identity: SemanticIdentity,
  actionId: FactActionId,
  nodes: Map<string, string[]>,
  occurrences: Map<string, string[]>,
  inlineReferences: Map<string, string[]>,
  inlineAliases: Map<string, string[]>,
  intrinsicNodeTypes: Map<string, string[]>,
): void {
  switch (identity.kind) {
    case "node":
      addCandidate(nodes, identity.nodeId, actionId);
      return;
    case "occurrence":
      addCandidate(occurrences, identity.occurrenceId, actionId);
      return;
    case "inline-reference":
      addCandidate(inlineReferences, identity.inlineReferenceId, actionId);
      return;
    case "inline-alias":
      addCandidate(inlineAliases, `${identity.inlineReferenceId}/${identity.aliasNodeId}`, actionId);
      return;
    case "intrinsic-node-type":
      addCandidate(
        intrinsicNodeTypes,
        intrinsicNodeTypeSupportKey(identity.nodeId, identity.intrinsicNodeType),
        actionId,
      );
      break;
    case "node-children":
    case "fact-action":
    case "supertag":
    case "field-definition":
      break;
  }
}

function actionSupport(
  fact: FactAction,
  context: Readonly<{
    nodeExistenceSupport: Map<string, string[]>;
    occurrenceExistenceSupport: Map<string, string[]>;
    viable: Set<FactActionId>;
    intrinsicNodeTypeSupport: Map<string, string[]>;
    causalCollectionSupport: CausalCollectionSupportContext;
    occurrenceMaterializationFacts: ReadonlyMap<string, readonly FactAction[]>;
    inlineReferenceSupport: Map<string, string[]>;
    inlineAliasSupport: Map<string, string[]>;
    causalRegisterSupport: ReadonlyMap<string, readonly FactAction[]>;
  }>,
): Set<FactActionId> {
  const authoredAction = fact.action;
  const support = new Set<FactActionId>();
  addIdentityRequirementSupport(support, authoredAction, context);
  for (const semanticKey of causalRegisterKeys(fact)) {
    for (const candidate of context.causalRegisterSupport.get(semanticKey) ?? []) {
      if (candidate.id !== fact.id && factObserves(fact, candidate)) {
        support.add(candidate.id);
      }
    }
  }
  addCausalCollectionSupport(support, fact, context.causalCollectionSupport, context.viable);
  addGeneratedOccurrenceSupport(support, fact, context.occurrenceMaterializationFacts);
  return support;
}

function indexOccurrenceMaterializationFacts(facts: readonly FactAction[]): ReadonlyMap<string, readonly FactAction[]> {
  const result = new Map<string, FactAction[]>();
  for (const fact of facts) {
    for (const contribution of factActionContributions(fact)) {
      if (contribution.kind !== "sequence-position" || contribution.operation !== "insert") {
        continue;
      }
      const candidates = result.get(contribution.occurrenceId) ?? [];
      candidates.push(fact);
      result.set(contribution.occurrenceId, candidates);
    }
  }
  return result;
}

function addGeneratedOccurrenceSupport(
  support: Set<string>,
  fact: FactAction,
  materializationFacts: ReadonlyMap<string, readonly FactAction[]>,
): void {
  for (const contribution of factActionContributions(fact)) {
    if (contribution.kind === "generated-occurrence") {
      const candidate = materializationFacts
        .get(contribution.occurrenceId)
        ?.find((materialization) => factObserves(materialization, fact));
      if (candidate !== undefined) {
        support.add(candidate.id);
      }
    }
  }
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
