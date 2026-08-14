import { FIELD_DEFINITION_NODE_TYPE, type ContributionFact, type Mutation } from "../fact/index.js";
import { addInitializationSupport } from "./generated-relation-support.js";
import {
  addMaterializedFieldSupport,
  addOccurrenceChangeSupport,
  addValueTargetSupport,
} from "./existence-mutation-support.js";
import { nodeTypeSupportKey, type SchemaSupportContext } from "./schema-support.js";
import { addCandidate, addIfPresent, effectiveCandidate } from "./support-candidate.js";

type CoreSupportMutation = Exclude<
  Mutation,
  Extract<
    Mutation,
    {
      kind:
        | `schema-${string}`
        | "template-node-detach"
        | "field-value-delete"
        | "materialized-field-delete";
    }
  >
>;

type CoreSupportContext = Readonly<{
  nodeExistenceSupport: Map<string, string[]>;
  occurrenceExistenceSupport: Map<string, string[]>;
  viable: Set<string>;
  existence: Readonly<{
    nodes: Map<string, string[]>;
    occurrences: Map<string, string[]>;
    viable: Set<string>;
  }>;
  schemaSupport: SchemaSupportContext;
}>;

export function addCoreMutationSupport(
  support: Set<string>,
  mutation: CoreSupportMutation,
  fact: ContributionFact,
  context: CoreSupportContext,
): void {
  const { nodeExistenceSupport, occurrenceExistenceSupport, viable, existence, schemaSupport } =
    context;
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
        schemaSupport.nodeTypeDeclarations,
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
      addIfPresent(
        support,
        effectiveCandidate(nodeExistenceSupport, mutation.parentNodeId, viable),
      );
      addCandidate(occurrenceExistenceSupport, mutation.occurrenceId, fact.id);
      break;
    case "occurrence-delete":
    case "occurrence-move":
      addOccurrenceChangeSupport(
        support,
        occurrenceExistenceSupport,
        nodeExistenceSupport,
        viable,
        mutation,
      );
      break;
    case "occurrence-restore":
      addIfPresent(
        support,
        effectiveCandidate(occurrenceExistenceSupport, mutation.occurrenceId, viable),
      );
      support.add(mutation.deletionFactId);
      addIfPresent(
        support,
        effectiveCandidate(nodeExistenceSupport, mutation.parentNodeId, viable),
      );
      occurrenceExistenceSupport.set(mutation.occurrenceId, [fact.id]);
      break;
    case "node-owner-set":
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.nodeId, viable));
      addIfPresent(support, effectiveCandidate(nodeExistenceSupport, mutation.ownerNodeId, viable));
      break;
    case "field-materialize":
      addMaterializedFieldSupport(support, mutation, existence);
      addIfPresent(
        support,
        effectiveCandidate(
          schemaSupport.nodeTypeDeclarations,
          nodeTypeSupportKey(mutation.fieldDefinitionId, FIELD_DEFINITION_NODE_TYPE),
          viable,
        ),
      );
      break;
    case "field-initialize":
      addInitializationSupport(support, mutation, fact, schemaSupport, existence);
      break;
    case "value-set":
    case "value-unset":
      addValueTargetSupport(support, mutation, existence);
      break;
  }
}
