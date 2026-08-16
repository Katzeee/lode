import {
  compareFacts,
  FIELD_DEFINITION_NODE_TYPE,
  isFieldDefinitionConfigMutation,
  stableStringCompare,
  type ContributionFact,
} from "../fact/index.js";
import { nodeLocation } from "./node-graph.js";
import type { FieldDefinitionConfiguration } from "./projection-types.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import type { WorkspaceSystemNodes } from "./workspace-system-nodes.js";

export function projectFieldDefinitionConfigurations(
  workspaceNodeId: string,
  active: readonly ContributionFact[],
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  metanodes: Readonly<Record<string, string>>,
  workspaceSystemNodes: WorkspaceSystemNodes,
): Readonly<Record<string, readonly FieldDefinitionConfiguration[]>> {
  const graph = { nodes: Object.fromEntries(nodes), nodeOwners, workspaceSystemNodes };
  const facts = [...active].sort(compareFacts);
  const superseded = new Set(
    facts.flatMap((fact) => {
      const mutation = fact.body.mutation;
      return isFieldDefinitionConfigMutation(mutation) ? (mutation.observedValueFactIds ?? []) : [];
    }),
  );
  const byDefinition = new Map<string, FieldDefinitionConfiguration[]>();
  for (const fact of facts) {
    const mutation = fact.body.mutation;
    if (!isFieldDefinitionConfigMutation(mutation) || superseded.has(fact.id)) {
      continue;
    }
    const rootNodeId = metanodes[mutation.fieldDefinitionId];
    const occurrence = occurrences.get(mutation.configurationOccurrenceId);
    if (
      rootNodeId === undefined ||
      nodes.get(mutation.fieldDefinitionId)?.nodeType !== FIELD_DEFINITION_NODE_TYPE ||
      occurrence?.nodeId !== mutation.configurationNodeId ||
      occurrence.parentNodeId !== rootNodeId ||
      nodeLocation(workspaceNodeId, graph, mutation.fieldDefinitionId) !== "active" ||
      nodeLocation(workspaceNodeId, graph, mutation.configurationNodeId) !== "active"
    ) {
      continue;
    }
    if (
      mutation.kind === "field-initialization-expression-configure" &&
      (nodes.get(mutation.expression.sourceFieldDefinitionId)?.nodeType !== FIELD_DEFINITION_NODE_TYPE ||
        nodeLocation(workspaceNodeId, graph, mutation.expression.sourceFieldDefinitionId) !== "active")
    ) {
      continue;
    }
    const configuration: FieldDefinitionConfiguration =
      mutation.kind === "field-datatype-configure"
        ? {
            kind: "datatype",
            configurationNodeId: mutation.configurationNodeId,
            configurationOccurrenceId: mutation.configurationOccurrenceId,
            datatype: mutation.datatype,
            contributionId: fact.id,
          }
        : mutation.kind === "field-cardinality-configure"
          ? {
              kind: "cardinality",
              configurationNodeId: mutation.configurationNodeId,
              configurationOccurrenceId: mutation.configurationOccurrenceId,
              cardinality: mutation.cardinality,
              contributionId: fact.id,
            }
          : {
              kind: "initialization-expression",
              configurationNodeId: mutation.configurationNodeId,
              configurationOccurrenceId: mutation.configurationOccurrenceId,
              expression: mutation.expression,
              contributionId: fact.id,
            };
    const values = byDefinition.get(mutation.fieldDefinitionId) ?? [];
    values.push(configuration);
    byDefinition.set(mutation.fieldDefinitionId, values);
  }
  return Object.fromEntries(
    [...byDefinition]
      .sort(([left], [right]) => stableStringCompare(left, right))
      .map(([fieldDefinitionId, configurations]) => {
        const rootNodeId = metanodes[fieldDefinitionId];
        const order = rootNodeId === undefined ? [] : (childOccurrences.get(rootNodeId) ?? []);
        return [
          fieldDefinitionId,
          configurations.sort(
            (left, right) =>
              order.indexOf(left.configurationOccurrenceId) - order.indexOf(right.configurationOccurrenceId) ||
              stableStringCompare(left.kind, right.kind) ||
              stableStringCompare(left.configurationNodeId, right.configurationNodeId) ||
              stableStringCompare(left.contributionId, right.contributionId),
          ),
        ] as const;
      }),
  );
}
