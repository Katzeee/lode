import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SEARCH_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type SearchExpressionMutation,
  type SearchExpressionSpec,
  visitSearchExpression,
} from "../fact/index.js";
import type { CoreSupportContext } from "./core-mutation-support.js";
import { intrinsicNodeTypeSupportKey } from "./supertag-support.js";
import { addIfPresent, effectiveCandidate } from "./support-candidate.js";

export function addSearchExpressionAttachSupport(
  support: Set<string>,
  mutation: SearchExpressionMutation,
  context: CoreSupportContext,
): void {
  const { nodeExistenceSupport, occurrenceExistenceSupport, viable, supertagSupport } = context;
  addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.searchNodeId, viable));
  addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.expressionNodeId, viable));
  addIfPresent(support, effectiveCandidate(occurrenceExistenceSupport, mutation.expressionOccurrenceId, viable));
  addIfPresent(support, effectiveCandidate(occurrenceExistenceSupport, mutation.definitionOccurrenceId, viable));
  addIfPresent(
    support,
    effectiveCandidate(
      supertagSupport.intrinsicNodeTypeDeclarations,
      intrinsicNodeTypeSupportKey(mutation.searchNodeId, SEARCH_INTRINSIC_NODE_TYPE),
      viable,
    ),
  );
  addSearchExpressionOperandSupport(support, mutation.expression, context);
}

export function addSearchExpressionDetachSupport(
  support: Set<string>,
  mutation: Extract<SearchExpressionMutation, { kind: "search-expression-detach" }>,
  context: CoreSupportContext,
): void {
  const { nodeExistenceSupport, viable, supertagSupport } = context;
  addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.searchNodeId, viable));
  addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.expressionNodeId, viable));
  addIfPresent(
    support,
    effectiveCandidate(
      supertagSupport.intrinsicNodeTypeDeclarations,
      intrinsicNodeTypeSupportKey(mutation.searchNodeId, SEARCH_INTRINSIC_NODE_TYPE),
      viable,
    ),
  );
  addSearchExpressionOperandSupport(support, mutation.expression, context);
}

export function addSearchExpressionOperandSupport(
  support: Set<string>,
  expressionSpec: SearchExpressionSpec,
  context: CoreSupportContext,
): void {
  const { nodeExistenceSupport, viable, supertagSupport } = context;
  visitSearchExpression(expressionSpec, (expression) => {
    const [nodeId, intrinsicNodeType] = expressionSupportTarget(expression);
    if (expression.kind === "field-value" && expression.value.kind === "node") {
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, expression.value.nodeId, viable));
    }
    if (nodeId === undefined) {
      return;
    }
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, nodeId, viable));
    if (intrinsicNodeType !== undefined) {
      addIfPresent(
        support,
        effectiveCandidate(
          supertagSupport.intrinsicNodeTypeDeclarations,
          intrinsicNodeTypeSupportKey(nodeId, intrinsicNodeType),
          viable,
        ),
      );
    }
  });
}

export function addFieldDefinitionSupport(support: Set<string>, nodeId: string, context: CoreSupportContext): void {
  const { nodeExistenceSupport, viable, supertagSupport } = context;
  addIfPresent(support, effectiveCandidate(nodeExistenceSupport, nodeId, viable));
  addIfPresent(
    support,
    effectiveCandidate(
      supertagSupport.intrinsicNodeTypeDeclarations,
      intrinsicNodeTypeSupportKey(nodeId, FIELD_DEFINITION_INTRINSIC_NODE_TYPE),
      viable,
    ),
  );
}

function expressionSupportTarget(
  expression: SearchExpressionSpec,
): readonly [string | undefined, "supertag-definition" | "field-definition" | undefined] {
  if (expression.kind === "supertag") {
    return [expression.supertagId, SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE];
  }
  if (expression.kind === "field-defined" || expression.kind === "field-value" || expression.kind === "date-compare") {
    return [expression.fieldDefinitionId, FIELD_DEFINITION_INTRINSIC_NODE_TYPE];
  }
  if ((expression.kind === "descendant-of" || expression.kind === "child-of") && expression.target.kind === "node") {
    return [expression.target.nodeId, undefined];
  }
  return expression.kind === "links-to" ? [expression.targetNodeId, undefined] : [undefined, undefined];
}
