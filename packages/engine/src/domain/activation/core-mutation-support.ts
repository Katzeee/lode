import {
  FIELD_DEFINITION_NODE_TYPE,
  SUPERTAG_DEFINITION_NODE_TYPE,
  SEARCH_NODE_TYPE,
  type ContributionFact,
  type FieldContentDeletionMutation,
  type Mutation,
  type SearchClauseMutation,
  type SupertagMutation,
  type TemplateMutation,
  type ViewMutation,
} from "../fact/index.js";
import { addInitializationSupport } from "./generated-relation-support.js";
import { addMaterializedFieldSupport, addOccurrenceChangeSupport } from "./existence-mutation-support.js";
import { nodeTypeSupportKey, type SupertagSupportContext } from "./supertag-support.js";
import { addCandidate, addIfPresent, effectiveCandidate } from "./support-candidate.js";

type CoreSupportMutation = Exclude<Mutation, SupertagMutation | TemplateMutation | FieldContentDeletionMutation>;

type CoreSupportContext = Readonly<{
  nodeExistenceSupport: Map<string, string[]>;
  occurrenceExistenceSupport: Map<string, string[]>;
  viable: Set<string>;
  existence: Readonly<{
    nodes: Map<string, string[]>;
    occurrences: Map<string, string[]>;
    viable: Set<string>;
  }>;
  supertagSupport: SupertagSupportContext;
  inlineReferenceSupport: Map<string, string[]>;
  inlineAliasSupport: Map<string, string[]>;
}>;

export function addCoreMutationSupport(
  support: Set<string>,
  mutation: CoreSupportMutation,
  fact: ContributionFact,
  context: CoreSupportContext,
): void {
  const { nodeExistenceSupport, occurrenceExistenceSupport, viable, existence, supertagSupport } = context;
  switch (mutation.kind) {
    case "node-create":
      break;
    case "node-delete":
    case "text-splice":
    case "text-mark":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
      break;
    case "node-type-declare":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
      addCandidate(
        supertagSupport.nodeTypeDeclarations,
        nodeTypeSupportKey(mutation.nodeId, mutation.nodeType),
        fact.id,
      );
      break;
    case "node-restore":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
      support.add(mutation.deletionFactId);
      nodeExistenceSupport.set(mutation.nodeId, [fact.id]);
      break;
    case "occurrence-create":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.parentNodeId, viable));
      addCandidate(occurrenceExistenceSupport, mutation.occurrenceId, fact.id);
      break;
    case "occurrence-delete":
    case "occurrence-move":
      addOccurrenceChangeSupport(support, occurrenceExistenceSupport, nodeExistenceSupport, viable, mutation);
      break;
    case "occurrence-restore":
      addIfPresent(support, effectiveCandidate(occurrenceExistenceSupport, mutation.occurrenceId, viable));
      support.add(mutation.deletionFactId);
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.parentNodeId, viable));
      occurrenceExistenceSupport.set(mutation.occurrenceId, [fact.id]);
      break;
    case "node-owner-set":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.ownerNodeId, viable));
      break;
    case "metanode-attach":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.hostNodeId, viable));
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.metanodeId, viable));
      break;
    case "inline-reference-create":
    case "inline-reference-delete":
    case "inline-reference-alias-attach":
    case "inline-reference-alias-detach":
      return addInlineReferenceSupport(support, mutation, fact, context);
    case "search-supertag-clause-attach":
    case "search-field-clause-attach":
      addSearchClauseSupport(support, mutation, context);
      break;
    case "shared-default-view-definition-attach":
    case "shared-default-view-definition-mode-set":
      return addViewSupport(support, mutation, context);
    case "field-materialize":
      addMaterializedFieldSupport(support, mutation, existence);
      addIfPresent(
        support,
        effectiveCandidate(
          supertagSupport.nodeTypeDeclarations,
          nodeTypeSupportKey(mutation.fieldDefinitionId, FIELD_DEFINITION_NODE_TYPE),
          viable,
        ),
      );
      break;
    case "field-initialize":
      addInitializationSupport(support, mutation, fact, supertagSupport, existence);
      break;
    case "field-datatype-configure":
    case "field-cardinality-configure":
    case "field-initialization-expression-configure":
      addFieldDefinitionConfigurationSupport(support, mutation, context);
      break;
    default:
      assertNever(mutation);
  }
}

function addFieldDefinitionConfigurationSupport(
  support: Set<string>,
  mutation: Extract<
    CoreSupportMutation,
    {
      kind: "field-datatype-configure" | "field-cardinality-configure" | "field-initialization-expression-configure";
    }
  >,
  context: CoreSupportContext,
): void {
  const { nodeExistenceSupport, occurrenceExistenceSupport, viable, supertagSupport } = context;
  addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.fieldDefinitionId, viable));
  addIfPresent(
    support,
    effectiveCandidate(
      supertagSupport.nodeTypeDeclarations,
      nodeTypeSupportKey(mutation.fieldDefinitionId, FIELD_DEFINITION_NODE_TYPE),
      viable,
    ),
  );
  addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.configurationNodeId, viable));
  addIfPresent(support, effectiveCandidate(occurrenceExistenceSupport, mutation.configurationOccurrenceId, viable));
  mutation.observedValueFactIds?.forEach((id) => support.add(id));
  if (mutation.kind === "field-initialization-expression-configure") {
    addIfPresent(
      support,
      effectiveCandidate(nodeExistenceSupport, mutation.expression.sourceFieldDefinitionId, viable),
    );
    addIfPresent(
      support,
      effectiveCandidate(
        supertagSupport.nodeTypeDeclarations,
        nodeTypeSupportKey(mutation.expression.sourceFieldDefinitionId, FIELD_DEFINITION_NODE_TYPE),
        viable,
      ),
    );
  }
}

function addInlineReferenceSupport(
  support: Set<string>,
  mutation: Extract<CoreSupportMutation, { kind: `inline-reference-${string}` }>,
  fact: ContributionFact,
  context: CoreSupportContext,
): void {
  const { nodeExistenceSupport, inlineReferenceSupport, inlineAliasSupport, viable } = context;
  if (mutation.kind === "inline-reference-create") {
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.hostNodeId, viable));
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.targetNodeId, viable));
    addCandidate(inlineReferenceSupport, mutation.inlineReferenceId, fact.id);
    return;
  }
  addIfPresent(support, effectiveCandidate(inlineReferenceSupport, mutation.inlineReferenceId, viable));
  if (mutation.kind === "inline-reference-alias-attach") {
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.aliasNodeId, viable));
    addCandidate(inlineAliasSupport, `${mutation.inlineReferenceId}/${mutation.aliasNodeId}`, fact.id);
  } else if (mutation.kind === "inline-reference-alias-detach") {
    addIfPresent(
      support,
      effectiveCandidate(inlineAliasSupport, `${mutation.inlineReferenceId}/${mutation.aliasNodeId}`, viable),
    );
  }
}

function addViewSupport(support: Set<string>, mutation: ViewMutation, context: CoreSupportContext): void {
  const { nodeExistenceSupport, occurrenceExistenceSupport, viable } = context;
  addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.viewDefinitionNodeId, viable));
  if (mutation.kind === "shared-default-view-definition-attach") {
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.hostNodeId, viable));
    addIfPresent(support, effectiveCandidate(occurrenceExistenceSupport, mutation.viewDefinitionOccurrenceId, viable));
  }
}

function addSearchClauseSupport(
  support: Set<string>,
  mutation: SearchClauseMutation,
  context: CoreSupportContext,
): void {
  const { nodeExistenceSupport, occurrenceExistenceSupport, viable, supertagSupport } = context;
  addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.searchNodeId, viable));
  addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.clauseNodeId, viable));
  addIfPresent(support, effectiveCandidate(occurrenceExistenceSupport, mutation.clauseOccurrenceId, viable));
  addIfPresent(
    support,
    effectiveCandidate(
      supertagSupport.nodeTypeDeclarations,
      nodeTypeSupportKey(mutation.searchNodeId, SEARCH_NODE_TYPE),
      viable,
    ),
  );
  const operandNodeId =
    mutation.kind === "search-supertag-clause-attach" ? mutation.supertagId : mutation.fieldDefinitionId;
  const operandNodeType =
    mutation.kind === "search-supertag-clause-attach" ? SUPERTAG_DEFINITION_NODE_TYPE : FIELD_DEFINITION_NODE_TYPE;
  addIfPresent(support, effectiveCandidate(nodeExistenceSupport, operandNodeId, viable));
  addIfPresent(
    support,
    effectiveCandidate(
      supertagSupport.nodeTypeDeclarations,
      nodeTypeSupportKey(operandNodeId, operandNodeType),
      viable,
    ),
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled core Activation support: ${JSON.stringify(value)}`);
}
