import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  isFactActionId,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type SearchClause,
  type SearchExpressionAction,
} from "../fact/index.js";
import type { CoreSupportContext } from "./core-action-support.js";
import { intrinsicNodeTypeSupportKey } from "./supertag-support.js";
import { addIfPresent, effectiveCandidate } from "./support-candidate.js";

export function addSearchExpressionSupport(
  support: Set<string>,
  action: SearchExpressionAction,
  context: CoreSupportContext,
): void {
  if (action.kind === "search-expression-add") {
    if (isFactActionId(action.expressionHostId)) {
      support.add(action.expressionHostId);
    } else {
      addIfPresent(support, effectiveCandidate(context.nodeExistenceSupport, action.expressionHostId, context.viable));
    }
    if (action.parentExpressionId !== null) {
      support.add(action.parentExpressionId);
    }
    addSearchClauseSupport(support, action.clause, context);
    return;
  }
  support.add(action.expressionId);
  if (action.kind === "search-expression-configure") {
    addSearchClauseSupport(support, action.clause, context);
  }
  if (action.kind === "search-expression-move" && action.parentExpressionId !== null) {
    support.add(action.parentExpressionId);
  }
}

function addSearchClauseSupport(support: Set<string>, clause: SearchClause, context: CoreSupportContext): void {
  const { nodeExistenceSupport, viable, supertagSupport } = context;
  const [nodeId, intrinsicNodeType] = clauseSupportTarget(clause);
  if (clause.kind === "field-value" && clause.value.kind === "node") {
    addIfPresent(support, effectiveCandidate(nodeExistenceSupport, clause.value.nodeId, viable));
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

function clauseSupportTarget(
  clause: SearchClause,
): readonly [string | undefined, "supertag-definition" | "field-definition" | undefined] {
  if (clause.kind === "supertag") {
    return [clause.supertagId, SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE];
  }
  if (clause.kind === "field-defined" || clause.kind === "field-value" || clause.kind === "date-compare") {
    return [clause.fieldDefinitionId, FIELD_DEFINITION_INTRINSIC_NODE_TYPE];
  }
  if ((clause.kind === "descendant-of" || clause.kind === "child-of") && clause.target.kind === "node") {
    return [clause.target.nodeId, undefined];
  }
  return clause.kind === "links-to" ? [clause.targetNodeId, undefined] : [undefined, undefined];
}
