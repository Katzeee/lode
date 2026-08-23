import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type FieldContentRemovalAction,
  type AuthoredAction,
  type SupertagAction,
  type TemplateAction,
  type ViewAction,
  VIEW_SORT_NODE_NAME_NODE_ID,
} from "../fact/index.js";
import { addMaterializedFieldSupport, addOccurrenceChangeSupport } from "./existence-action-support.js";
import { addFieldDefinitionSupport, addSearchExpressionSupport } from "./search-action-support.js";
import { intrinsicNodeTypeSupportKey, type SupertagSupportContext } from "./supertag-support.js";
import { addIfPresent, effectiveCandidate } from "./support-candidate.js";

type CoreSupportAction = Exclude<AuthoredAction, SupertagAction | TemplateAction | FieldContentRemovalAction>;

export type CoreSupportContext = Readonly<{
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

export function addCoreActionSupport(
  support: Set<string>,
  authoredAction: CoreSupportAction,
  context: CoreSupportContext,
): void {
  const { nodeExistenceSupport, occurrenceExistenceSupport, viable, existence, supertagSupport } = context;
  switch (authoredAction.kind) {
    case "workspace-bootstrap":
      break;
    case "node-create":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.ownerNodeId, viable));
      break;
    case "node-trash":
    case "rich-text-splice":
    case "rich-text-mark":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.nodeId, viable));
      break;
    case "node-restore":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.nodeId, viable));
      addIfPresent(support, effectiveCandidate(occurrenceExistenceSupport, authoredAction.placementId, viable));
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.parentNodeId, viable));
      break;
    case "original-promote":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.nodeId, viable));
      addIfPresent(support, effectiveCandidate(occurrenceExistenceSupport, authoredAction.placementId, viable));
      break;
    case "placement-create":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.nodeId, viable));
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.parentNodeId, viable));
      break;
    case "placement-remove":
    case "placement-move":
      addOccurrenceChangeSupport(support, occurrenceExistenceSupport, nodeExistenceSupport, viable, authoredAction);
      break;
    case "inline-reference-create":
    case "inline-reference-remove":
    case "inline-alias-attach":
    case "inline-alias-detach":
      return addInlineReferenceSupport(support, authoredAction, context);
    case "search-expression-add":
    case "search-expression-configure":
    case "search-expression-move":
    case "search-expression-remove":
    case "search-expression-restore":
      addSearchExpressionSupport(support, authoredAction, context);
      break;
    case "shared-default-view-add":
    case "shared-default-view-remove":
    case "shared-default-view-restore":
    case "view-mode-set":
    case "view-column-add":
    case "view-column-remove":
    case "view-column-move":
    case "view-sort-add":
    case "view-sort-configure":
    case "view-sort-remove":
    case "view-sort-restore":
    case "view-group-add":
    case "view-group-remove":
    case "view-filter-add":
    case "view-filter-remove":
    case "view-filter-restore":
      return addViewSupport(support, authoredAction, context);
    case "field-materialize":
      addMaterializedFieldSupport(support, authoredAction, existence);
      addIfPresent(
        support,
        effectiveCandidate(
          supertagSupport.intrinsicNodeTypeDeclarations,
          intrinsicNodeTypeSupportKey(authoredAction.fieldDefinitionId, FIELD_DEFINITION_INTRINSIC_NODE_TYPE),
          viable,
        ),
      );
      break;
    case "field-configuration-set":
      addFieldDefinitionConfigurationSupport(support, authoredAction, context);
      break;
    case "field-definition-make-discoverable":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.fieldDefinitionId, viable));
      break;
    case "field-definition-return-to-template-field":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.fieldDefinitionId, viable));
      support.add(authoredAction.templateFieldId);
      break;
    default:
      assertNever(authoredAction);
  }
}

function addFieldDefinitionConfigurationSupport(
  support: Set<string>,
  authoredAction: Extract<CoreSupportAction, { kind: "field-configuration-set" }>,
  context: CoreSupportContext,
): void {
  const { nodeExistenceSupport, viable, supertagSupport } = context;
  addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.fieldDefinitionId, viable));
  addIfPresent(
    support,
    effectiveCandidate(
      supertagSupport.intrinsicNodeTypeDeclarations,
      intrinsicNodeTypeSupportKey(authoredAction.fieldDefinitionId, FIELD_DEFINITION_INTRINSIC_NODE_TYPE),
      viable,
    ),
  );
  const configuration = authoredAction.configuration;
  if (configuration.kind === "datatype") {
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, configuration.datatypeNodeId, viable));
    if (configuration.optionsSupertagId !== undefined) {
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, configuration.optionsSupertagId, viable));
      addIfPresent(
        support,
        effectiveCandidate(
          supertagSupport.intrinsicNodeTypeDeclarations,
          intrinsicNodeTypeSupportKey(configuration.optionsSupertagId, SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE),
          viable,
        ),
      );
    }
  } else if (configuration.kind === "cardinality") {
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, configuration.cardinalityNodeId, viable));
  } else if (configuration.kind === "optionality") {
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, configuration.optionalityNodeId, viable));
  } else {
    addIfPresent(
      support,
      effectiveCandidate(nodeExistenceSupport, configuration.expression.sourceFieldDefinitionId, viable),
    );
    addIfPresent(
      support,
      effectiveCandidate(
        supertagSupport.intrinsicNodeTypeDeclarations,
        intrinsicNodeTypeSupportKey(
          configuration.expression.sourceFieldDefinitionId,
          FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
        ),
        viable,
      ),
    );
  }
}

function addInlineReferenceSupport(
  support: Set<string>,
  authoredAction: Extract<
    CoreSupportAction,
    { kind: "inline-reference-create" | "inline-reference-remove" | "inline-alias-attach" | "inline-alias-detach" }
  >,
  context: CoreSupportContext,
): void {
  const { nodeExistenceSupport, inlineReferenceSupport, inlineAliasSupport, viable } = context;
  if (authoredAction.kind === "inline-reference-create") {
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.hostNodeId, viable));
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.targetNodeId, viable));
    return;
  }
  addIfPresent(support, effectiveCandidate(inlineReferenceSupport, authoredAction.inlineReferenceId, viable));
  if (authoredAction.kind === "inline-alias-attach") {
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.aliasNodeId, viable));
  } else if (authoredAction.kind === "inline-alias-detach") {
    addIfPresent(
      support,
      effectiveCandidate(
        inlineAliasSupport,
        `${authoredAction.inlineReferenceId}/${authoredAction.aliasNodeId}`,
        viable,
      ),
    );
  }
}

function addViewSupport(support: Set<string>, authoredAction: ViewAction, context: CoreSupportContext): void {
  const { nodeExistenceSupport, viable } = context;
  if (authoredAction.kind === "shared-default-view-add" || authoredAction.kind === "shared-default-view-remove") {
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.hostNodeId, viable));
    return;
  }
  const targetId =
    authoredAction.kind === "shared-default-view-restore" ||
    authoredAction.kind === "view-mode-set" ||
    authoredAction.kind === "view-column-add" ||
    authoredAction.kind === "view-column-remove" ||
    authoredAction.kind === "view-sort-add" ||
    authoredAction.kind === "view-sort-remove" ||
    authoredAction.kind === "view-group-add" ||
    authoredAction.kind === "view-group-remove" ||
    authoredAction.kind === "view-filter-add" ||
    authoredAction.kind === "view-filter-remove"
      ? authoredAction.viewId
      : authoredAction.kind === "view-column-move"
        ? authoredAction.columnId
        : authoredAction.kind === "view-sort-configure" || authoredAction.kind === "view-sort-restore"
          ? authoredAction.sortId
          : authoredAction.filterId;
  support.add(targetId);
  if (
    authoredAction.kind === "view-column-add" ||
    authoredAction.kind === "view-sort-add" ||
    authoredAction.kind === "view-sort-configure" ||
    authoredAction.kind === "view-group-add"
  ) {
    if (authoredAction.fieldDefinitionId === VIEW_SORT_NODE_NAME_NODE_ID) {
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, authoredAction.fieldDefinitionId, viable));
    } else {
      addFieldDefinitionSupport(support, authoredAction.fieldDefinitionId, context);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled core Activation support: ${JSON.stringify(value)}`);
}
