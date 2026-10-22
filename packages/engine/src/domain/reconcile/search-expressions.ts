import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SEARCH_INTRINSIC_NODE_TYPE,
  stableStringCompare,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  type FactAction,
  type FactActionId,
  type SearchClause,
  type SearchExpressionSpec,
  visitSearchExpression,
} from "../fact/index.js";
import { nodeLocation } from "./node-graph.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import type { SearchExpression } from "./projection-types.js";
import { searchExpressionStates, type SearchExpressionState } from "./search-expression-graph.js";
import type { WorkspaceSystemNodes } from "./workspace-system-nodes.js";

export function projectSearchExpressions(
  workspaceNodeId: string,
  active: readonly FactAction[],
  nodes: ReadonlyMap<string, MutableNode>,
  _occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  _metanodes: Readonly<Record<string, string>>,
  workspaceSystemNodes: WorkspaceSystemNodes,
): Readonly<Record<string, SearchExpression>> {
  const graph = { nodes: Object.fromEntries(nodes), nodeOwners, workspaceSystemNodes };
  const states = searchExpressionStates(active);
  const searchNodeIds = [...new Set(states.map((state) => state.addition.action.expressionHostId))]
    .filter((id) => nodes.get(id)?.intrinsicNodeType === SEARCH_INTRINSIC_NODE_TYPE)
    .sort(stableStringCompare);
  return Object.fromEntries(
    searchNodeIds.flatMap((searchNodeId) => {
      if (nodeLocation(workspaceNodeId, graph, searchNodeId) !== "active") {
        return [];
      }
      const projected = projectSearchExpressionForHost(
        searchNodeId,
        states,
        childOccurrences,
        workspaceNodeId,
        graph,
        nodes,
      );
      return projected ? [[searchNodeId, projected] as const] : [];
    }),
  );
}

export function projectSearchExpressionForHost(
  hostId: string,
  states: readonly SearchExpressionState[],
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  workspaceNodeId: string,
  graph: Readonly<{
    nodes: Readonly<Record<string, unknown>>;
    nodeOwners: Readonly<Record<string, string | null>>;
    workspaceSystemNodes: WorkspaceSystemNodes;
  }>,
  nodes: ReadonlyMap<string, MutableNode>,
): SearchExpression | null {
  const roots = states.filter(
    (state) => state.addition.action.expressionHostId === hostId && state.parentExpressionId === null && usable(state),
  );
  if (roots.length !== 1) {
    return null;
  }
  const root = roots[0];
  if (!root) {
    return null;
  }
  const expression = buildExpression(root, states, childOccurrences, new Set());
  return !expression || !validSearchExpression(expression, workspaceNodeId, graph, nodes)
    ? null
    : {
        expressionNodeId: root.identity.expressionNodeId,
        expressionOccurrenceId: root.identity.expressionOccurrenceId,
        definitionOccurrenceId: root.identity.definitionOccurrenceId,
        expression,
      };
}

function buildExpression(
  state: SearchExpressionState,
  states: readonly SearchExpressionState[],
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  visited: Set<FactActionId>,
): SearchExpressionSpec | null {
  if (!usable(state) || visited.has(state.addition.id) || !state.clause) {
    return null;
  }
  visited.add(state.addition.id);
  const children = states
    .filter((candidate) => candidate.parentExpressionId === state.addition.id && usable(candidate))
    .sort((left, right) => {
      const order = childOccurrences.get(state.identity.expressionNodeId) ?? [];
      return order.indexOf(left.identity.expressionOccurrenceId) - order.indexOf(right.identity.expressionOccurrenceId);
    });
  const resolved = children.map((child) => buildExpression(child, states, childOccurrences, visited));
  if (resolved.some((child) => child === null)) {
    return null;
  }
  const operands = resolved as SearchExpressionSpec[];
  const clause = state.clause;
  if (clause.kind === "and" || clause.kind === "or") {
    return operands.length > 0
      ? {
          expressionId: state.addition.id,
          expressionNodeId: state.identity.expressionNodeId,
          kind: clause.kind,
          operands,
        }
      : null;
  }
  if (clause.kind === "not") {
    const operand = operands.length === 1 ? operands[0] : undefined;
    return operand
      ? {
          expressionId: state.addition.id,
          expressionNodeId: state.identity.expressionNodeId,
          kind: clause.kind,
          operand,
        }
      : null;
  }
  if (operands.length > 0) {
    return null;
  }
  return {
    expressionId: state.addition.id,
    expressionNodeId: state.identity.expressionNodeId,
    ...clause,
  } as SearchExpressionSpec;
}

function usable(state: SearchExpressionState): boolean {
  return !state.removed && !state.positionConflicted && state.clause !== null;
}

function validSearchExpression(
  expression: SearchExpressionSpec,
  workspaceNodeId: string,
  graph: Readonly<{
    nodes: Readonly<Record<string, unknown>>;
    nodeOwners: Readonly<Record<string, string | null>>;
    workspaceSystemNodes: WorkspaceSystemNodes;
  }>,
  nodes: ReadonlyMap<string, MutableNode>,
): boolean {
  let valid = true;
  visitSearchExpression(expression, (clause) => {
    const [nodeId, intrinsicNodeType] = supportTarget(clause);
    if (clause.kind === "field-value" && clause.value.kind === "node") {
      valid &&= nodeLocation(workspaceNodeId, graph, clause.value.nodeId) === "active";
    }
    if (nodeId !== undefined) {
      valid &&= nodeLocation(workspaceNodeId, graph, nodeId) === "active";
      if (intrinsicNodeType !== undefined) {
        valid &&= nodes.get(nodeId)?.intrinsicNodeType === intrinsicNodeType;
      }
    }
  });
  return valid;
}

function supportTarget(
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
