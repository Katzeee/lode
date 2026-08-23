import {
  actionRelations,
  compareCausalOrder,
  factObserves,
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type AuthoredAction,
  type FactAction,
  type IntrinsicNodeType,
  type SupertagAction,
} from "../fact/index.js";

export function addSupertagActionSupport(
  support: Set<string>,
  authoredAction: SupertagAction,
  fact: FactAction,
  context: SupertagSupportContext,
): void {
  if (authoredAction.kind === "supertag-application-add" || authoredAction.kind === "supertag-membership-remove") {
    addCandidateSupport(support, context.nodes, authoredAction.hostNodeId, context.viable);
  } else if (authoredAction.kind === "template-member-add" || authoredAction.kind === "template-member-remove") {
    addCandidateSupport(support, context.nodes, authoredAction.templateNodeId, context.viable);
    if (authoredAction.kind === "template-member-remove") {
      addLatestObservedSupport(
        support,
        context.templateOccurrences.get(templateMemberKey(authoredAction.supertagId, authoredAction.templateNodeId)) ??
          [],
        fact,
        context.viable,
      );
    }
  } else if (authoredAction.kind === "template-field-add") {
    if (authoredAction.fieldDefinition.kind === "existing") {
      addCandidateSupport(support, context.nodes, authoredAction.fieldDefinition.fieldDefinitionId, context.viable);
    }
    addRelationCandidate(
      context.templateFields,
      relationKey(authoredAction.supertagId, authoredAction.fieldDefinition.fieldDefinitionId),
      fact,
    );
  } else if (authoredAction.kind === "template-field-remove") {
    addLatestObservedSupport(
      support,
      context.templateFields.get(relationKey(authoredAction.supertagId, authoredAction.fieldDefinitionId)) ?? [],
      fact,
      context.viable,
    );
  } else if (
    authoredAction.kind === "template-field-restore" ||
    authoredAction.kind === "template-field-visibility-set" ||
    authoredAction.kind === "template-field-static-default-set"
  ) {
    support.add(authoredAction.templateFieldId);
  } else if (authoredAction.kind === "optional-field-contribution-add") {
    addCandidateSupport(support, context.nodes, authoredAction.fieldDefinitionId, context.viable);
    addRelationCandidate(
      context.optionalFields,
      relationKey(authoredAction.supertagId, authoredAction.fieldDefinitionId),
      fact,
    );
  } else if (authoredAction.kind === "optional-field-contribution-remove") {
    addLatestObservedSupport(
      support,
      context.optionalFields.get(relationKey(authoredAction.supertagId, authoredAction.fieldDefinitionId)) ?? [],
      fact,
      context.viable,
    );
  }

  const relations = actionRelations(authoredAction);
  for (const supertagId of relations.supertagIds) {
    addCandidateSupport(support, context.nodes, supertagId, context.viable);
    addIntrinsicNodeTypeSupport(support, context, supertagId, SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE);
  }
  for (const fieldDefinitionId of relations.fieldDefinitionIds) {
    const isNewDefinition =
      authoredAction.kind === "template-field-add" &&
      authoredAction.fieldDefinition.kind === "new" &&
      authoredAction.fieldDefinition.fieldDefinitionId === fieldDefinitionId;
    if (!isNewDefinition) {
      addCandidateSupport(support, context.nodes, fieldDefinitionId, context.viable);
      addIntrinsicNodeTypeSupport(support, context, fieldDefinitionId, FIELD_DEFINITION_INTRINSIC_NODE_TYPE);
    }
  }

  if (authoredAction.kind === "supertag-application-add") {
    addRelationCandidate(context.applications, relationKey(authoredAction.hostNodeId, authoredAction.supertagId), fact);
  } else if (authoredAction.kind === "template-member-add") {
    addRelationCandidate(
      context.templateOccurrences,
      templateMemberKey(authoredAction.supertagId, authoredAction.templateNodeId),
      fact,
    );
  }
}

export function addTemplateDetachmentSupport(
  support: Set<string>,
  authoredAction: Extract<AuthoredAction, { kind: "template-node-detach" }>,
  _fact: FactAction,
  context: SupertagSupportContext,
): void {
  addCandidateSupport(support, context.nodes, authoredAction.ownerNodeId, context.viable);
  addCandidateSupport(support, context.nodes, authoredAction.templateNodeId, context.viable);
}

export type SupertagSupportContext = Readonly<{
  nodes: ReadonlyMap<string, readonly string[]>;
  viable: ReadonlySet<string>;
  applications: Map<string, FactAction[]>;
  templateOccurrences: Map<string, FactAction[]>;
  templateFields: Map<string, FactAction[]>;
  optionalFields: Map<string, FactAction[]>;
  intrinsicNodeTypeDeclarations: Map<string, string[]>;
}>;

export function intrinsicNodeTypeSupportKey(nodeId: string, intrinsicNodeType: IntrinsicNodeType): string {
  return JSON.stringify([nodeId, intrinsicNodeType]);
}

function addIntrinsicNodeTypeSupport(
  support: Set<string>,
  context: SupertagSupportContext,
  nodeId: string,
  intrinsicNodeType: IntrinsicNodeType,
): void {
  addCandidateSupport(
    support,
    context.intrinsicNodeTypeDeclarations,
    intrinsicNodeTypeSupportKey(nodeId, intrinsicNodeType),
    context.viable,
  );
}

function templateMemberKey(supertagId: string, templateNodeId: string): string {
  return relationKey(supertagId, templateNodeId);
}

function relationKey(left: string, right: string): string {
  return JSON.stringify([left, right]);
}

function addRelationCandidate(index: Map<string, FactAction[]>, key: string, fact: FactAction): void {
  const values = index.get(key) ?? [];
  values.push(fact);
  index.set(key, values);
}

function addLatestObservedSupport(
  support: Set<string>,
  candidates: readonly FactAction[],
  observer: FactAction,
  viable: ReadonlySet<string>,
): void {
  const observed = candidates.filter((candidate) => factObserves(observer, candidate)).sort(compareCausalOrder);
  const candidate = [...observed].reverse().find((value) => viable.has(value.id)) ?? observed.at(-1);
  if (candidate) {
    support.add(candidate.id);
  }
}

function addCandidateSupport(
  support: Set<string>,
  candidates: ReadonlyMap<string, readonly string[]>,
  identity: string,
  viable: ReadonlySet<string>,
): void {
  const values = candidates.get(identity);
  const candidate = values?.find((id) => viable.has(id)) ?? values?.[0];
  if (candidate !== undefined) {
    support.add(candidate);
  }
}
