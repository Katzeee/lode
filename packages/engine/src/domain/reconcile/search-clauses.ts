import {
  compareFacts,
  FIELD_DEFINITION_NODE_TYPE,
  SUPERTAG_DEFINITION_NODE_TYPE,
  SEARCH_NODE_TYPE,
  stableStringCompare,
  type ContributionFact,
} from "../fact/index.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import type { SearchClause } from "./projection-types.js";
import { nodeLocation } from "./node-graph.js";
import type { WorkspaceSystemNodes } from "./workspace-system-nodes.js";

export function projectSearchClauses(
  workspaceNodeId: string,
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  metanodes: Readonly<Record<string, string>>,
  workspaceSystemNodes: WorkspaceSystemNodes,
): Readonly<Record<string, readonly SearchClause[]>> {
  const graph = { nodes: Object.fromEntries(nodes), nodeOwners, workspaceSystemNodes };
  const clauses = new Map<string, SearchClauseCandidate[]>();
  for (const fact of [...active].sort(compareFacts)) {
    const mutation = fact.body.mutation;
    if (mutation.kind !== "search-supertag-clause-attach" && mutation.kind !== "search-field-clause-attach") {
      continue;
    }
    const rootNodeId = metanodes[mutation.searchNodeId];
    const occurrence = occurrences.get(mutation.clauseOccurrenceId);
    const operandNodeId =
      mutation.kind === "search-supertag-clause-attach" ? mutation.supertagId : mutation.fieldDefinitionId;
    const expectedOperandType =
      mutation.kind === "search-supertag-clause-attach" ? SUPERTAG_DEFINITION_NODE_TYPE : FIELD_DEFINITION_NODE_TYPE;
    if (
      rootNodeId === undefined ||
      nodes.get(mutation.searchNodeId)?.nodeType !== SEARCH_NODE_TYPE ||
      nodes.get(operandNodeId)?.nodeType !== expectedOperandType ||
      occurrence?.nodeId !== mutation.clauseNodeId ||
      occurrence.parentNodeId !== rootNodeId ||
      nodeLocation(workspaceNodeId, graph, mutation.searchNodeId) !== "active" ||
      nodeLocation(workspaceNodeId, graph, mutation.clauseNodeId) !== "active" ||
      nodeLocation(workspaceNodeId, graph, operandNodeId) !== "active"
    ) {
      continue;
    }
    const clause: SearchClause =
      mutation.kind === "search-supertag-clause-attach"
        ? {
            kind: "supertag-instance-of",
            clauseNodeId: mutation.clauseNodeId,
            clauseOccurrenceId: mutation.clauseOccurrenceId,
            supertagId: mutation.supertagId,
          }
        : {
            kind: "field-defined",
            clauseNodeId: mutation.clauseNodeId,
            clauseOccurrenceId: mutation.clauseOccurrenceId,
            fieldDefinitionId: mutation.fieldDefinitionId,
          };
    const values = clauses.get(mutation.searchNodeId) ?? [];
    values.push({ clause, contributionId: fact.id });
    clauses.set(mutation.searchNodeId, values);
  }
  return Object.fromEntries(
    [...clauses]
      .sort(([left], [right]) => stableStringCompare(left, right))
      .map(([searchNodeId, candidates]) => {
        const rootNodeId = metanodes[searchNodeId];
        const order = rootNodeId === undefined ? [] : (childOccurrences.get(rootNodeId) ?? []);
        const unique = candidates.filter(
          (candidate, index, values) =>
            values.findIndex(
              (value) =>
                value.clause.clauseNodeId === candidate.clause.clauseNodeId &&
                predicateIdentity(value.clause) === predicateIdentity(candidate.clause),
            ) === index,
        );
        unique.sort(
          (left, right) =>
            order.indexOf(left.clause.clauseOccurrenceId) - order.indexOf(right.clause.clauseOccurrenceId) ||
            stableStringCompare(left.contributionId, right.contributionId),
        );
        return [searchNodeId, unique.map((candidate) => candidate.clause)] as const;
      }),
  );
}

type SearchClauseCandidate = Readonly<{ clause: SearchClause; contributionId: string }>;

function predicateIdentity(clause: SearchClause): string {
  return clause.kind === "supertag-instance-of"
    ? `${clause.kind}/${clause.supertagId}`
    : `${clause.kind}/${clause.fieldDefinitionId}`;
}
