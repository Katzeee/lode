import {
  canonicalJson,
  compareFacts,
  factObserves,
  SEARCH_EXPRESSION_DEFINITION_NODE_ID,
  SEARCH_INTRINSIC_NODE_TYPE,
  stableStringCompare,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  visitSearchExpression,
  type ContributionFact,
} from "../fact/index.js";
import { nodeLocation } from "./node-graph.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import type { SearchExpression } from "./projection-types.js";
import { projectTuple } from "./tuple.js";
import type { WorkspaceSystemNodes } from "./workspace-system-nodes.js";

export function projectSearchExpressions(
  workspaceNodeId: string,
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  metanodes: Readonly<Record<string, string>>,
  workspaceSystemNodes: WorkspaceSystemNodes,
): Readonly<Record<string, SearchExpression>> {
  const graph = { nodes: Object.fromEntries(nodes), nodeOwners, workspaceSystemNodes };
  const events = new Map<string, ContributionFact[]>();
  for (const fact of active) {
    if (
      fact.body.mutation.kind === "search-expression-attach" ||
      fact.body.mutation.kind === "search-expression-detach"
    ) {
      const values = events.get(fact.body.mutation.searchNodeId) ?? [];
      values.push(fact);
      events.set(fact.body.mutation.searchNodeId, values);
    }
  }
  const candidates = new Map<string, SearchExpression[]>();
  for (const [searchNodeId, facts] of events) {
    const maxima = facts.filter(
      (candidate) => !facts.some((other) => other.id !== candidate.id && factObserves(other, candidate)),
    );
    const unique = [...new Map(maxima.map((fact) => [canonicalJson(fact.body.mutation), fact])).values()].sort(
      compareFacts,
    );
    const fact = unique.length === 1 ? unique[0] : undefined;
    const mutation = fact?.body.mutation;
    if (mutation?.kind !== "search-expression-attach") {
      continue;
    }
    const metanodeId = metanodes[mutation.searchNodeId];
    const expressionOccurrence = occurrences.get(mutation.expressionOccurrenceId);
    const tuple = projectTuple(mutation.expressionNodeId, occurrences, childOccurrences, nodeOwners);
    const definitionEndpoint = tuple.endpoints[0];
    if (
      metanodeId === undefined ||
      nodes.get(mutation.searchNodeId)?.intrinsicNodeType !== SEARCH_INTRINSIC_NODE_TYPE ||
      expressionOccurrence?.nodeId !== mutation.expressionNodeId ||
      expressionOccurrence.parentNodeId !== metanodeId ||
      tuple.ownerNodeId !== metanodeId ||
      tuple.endpoints.length !== 1 ||
      definitionEndpoint?.occurrenceId !== mutation.definitionOccurrenceId ||
      definitionEndpoint.nodeId !== SEARCH_EXPRESSION_DEFINITION_NODE_ID ||
      definitionEndpoint.isOwning ||
      nodeLocation(workspaceNodeId, graph, mutation.searchNodeId) !== "active" ||
      nodeLocation(workspaceNodeId, graph, mutation.expressionNodeId) !== "active" ||
      !validSearchExpression(mutation.expression, workspaceNodeId, graph, nodes)
    ) {
      continue;
    }
    const values = candidates.get(searchNodeId) ?? [];
    values.push({
      expressionNodeId: mutation.expressionNodeId,
      expressionOccurrenceId: mutation.expressionOccurrenceId,
      definitionOccurrenceId: mutation.definitionOccurrenceId,
      expression: mutation.expression,
    });
    candidates.set(searchNodeId, values);
  }
  return Object.fromEntries(
    [...candidates]
      .sort(([left], [right]) => stableStringCompare(left, right))
      .flatMap(([searchNodeId, values]) => {
        const unique = values.filter(
          (candidate, index) =>
            values.findIndex(
              (value) =>
                value.expressionNodeId === candidate.expressionNodeId &&
                canonicalJson(value.expression) === canonicalJson(candidate.expression),
            ) === index,
        );
        const expression = unique.length === 1 ? unique[0] : undefined;
        return expression === undefined ? [] : ([[searchNodeId, expression]] as const);
      }),
  );
}

function validSearchExpression(
  expression: SearchExpression["expression"],
  workspaceNodeId: string,
  graph: Readonly<{
    nodes: Readonly<Record<string, unknown>>;
    nodeOwners: Readonly<Record<string, string | null>>;
    workspaceSystemNodes: WorkspaceSystemNodes;
  }>,
  nodes: ReadonlyMap<string, MutableNode>,
): boolean {
  let valid = true;
  visitSearchExpression(expression, (candidate) => {
    let nodeId: string | undefined;
    let intrinsicNodeType: "supertag-definition" | "field-definition" | undefined;
    if (candidate.kind === "supertag") {
      nodeId = candidate.supertagId;
      intrinsicNodeType = SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE;
    } else if (
      candidate.kind === "field-defined" ||
      candidate.kind === "field-value" ||
      candidate.kind === "date-compare"
    ) {
      nodeId = candidate.fieldDefinitionId;
      intrinsicNodeType = FIELD_DEFINITION_INTRINSIC_NODE_TYPE;
      if (candidate.kind === "field-value" && candidate.value.kind === "node") {
        valid &&= nodeLocation(workspaceNodeId, graph, candidate.value.nodeId) === "active";
      }
    } else if (
      (candidate.kind === "descendant-of" || candidate.kind === "child-of") &&
      candidate.target.kind === "node"
    ) {
      nodeId = candidate.target.nodeId;
    } else if (candidate.kind === "links-to") {
      nodeId = candidate.targetNodeId;
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
