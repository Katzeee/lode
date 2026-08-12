import { type ContributionFact } from "../fact/index.js";
import { compileOwnerDag, type OwnerKey } from "./owner-dag.js";
import {
  activeContributions,
  activeFactsFromCache,
  incrementalOwnerCache,
} from "./projection-active.js";
import { applyText, applyValues } from "./projection-content.js";
import { createNodes, createOccurrences } from "./projection-state.js";
import { validateStoredTree } from "./occurrence-tree.js";
import { normalizedCanonicals } from "./projection-canonicals.js";
import { assembleProjection } from "./projection-value-assembly.js";
import { deriveSchemaRelations } from "./schema-relations.js";
import { projectConflictIssues } from "./projection-conflicts.js";
import { projectInitializedFields } from "./initialized-field.js";
import type { ProjectionOwnerContext } from "./projection-owner-context.js";
import { projectDefinitionStatuses } from "./definition-status.js";
import { knownNodeIds, nodeDeletionFactIds } from "./node-lifecycle.js";
import { excludePurgedContributions, purgedNodeIds } from "./maintenance-projection.js";
import {
  projectTemplateNodeInstances,
  removeTemplateNodeOutputs,
} from "./template-node-projection.js";
import { pendingProposalFacts } from "../review/evidence.js";
import { reviewPaginationScopes } from "../review/pagination-scopes.js";

export type { ProjectionOwnerObserver } from "./projection-owner-context.js";
function evaluated(
  key: OwnerKey,
  evaluate: (context: ProjectionOwnerContext) => void,
): (context: ProjectionOwnerContext) => void {
  return (context) => {
    context.observer?.(key, context.view);
    evaluate(context);
  };
}
export const PROJECTION_OWNER_DAG = compileOwnerDag<ProjectionOwnerContext>([
  {
    key: "activation",
    dependencies: [],
    writes: ["active-contributions", "support-index"],
    evaluate: evaluated("activation", (context) => {
      if (context.incremental) {
        context.ownerCache = incrementalOwnerCache(
          context.previousOwnerCache,
          context.active,
          context.snapshot,
        );
        context.allActive = context.requiresAllActive
          ? activeFactsFromCache(context.snapshot, context.previousOwnerCache, context.active)
          : context.active;
        const purged = purgedNodeIds(context.snapshot.facts);
        context.active = excludePurgedContributions(context.active, purged);
        context.allActive = excludePurgedContributions(context.allActive, purged);
        return;
      }
      const activation = activeContributions(context.snapshot, context.view);
      const purged = purgedNodeIds(context.snapshot.facts);
      context.active = excludePurgedContributions(activation.facts, purged);
      context.allActive = context.active;
      context.ownerCache = activation.cache;
    }),
  },
  {
    key: "node",
    dependencies: ["activation"],
    writes: ["stored-nodes"],
    evaluate: evaluated("node", (context) => {
      context.nodes = createNodes(context.replayAllActive ? context.allActive : context.active);
    }),
  },
  {
    key: "occurrence",
    dependencies: ["node"],
    writes: ["stored-occurrences", "stored-children"],
    evaluate: evaluated("occurrence", (context) => {
      const result = createOccurrences(
        context.replayAllActive ? context.allActive : context.active,
        context.nodes,
      );
      context.occurrences = result.occurrences;
      context.children = result.children;
    }),
  },
  {
    key: "text",
    dependencies: ["node", "schema"],
    writes: ["text"],
    evaluate: evaluated("text", (context) => {
      if (context.replayAllActive) {
        for (const node of context.nodes.values()) {
          if (!context.managedTextReplayNodeIds.has(node.nodeId)) {
            node.text = [];
          }
        }
        applyText(context.allActive, context.nodes);
        return;
      }
      const templateSnapshotNodeIds = new Set(
        context.templateNodeInstances.flatMap((instance) =>
          instance.instanceNodeId === null ? [] : [instance.instanceNodeId],
        ),
      );
      for (const nodeId of context.managedTextReplayNodeIds) {
        const node = context.nodes.get(nodeId);
        if (node && !templateSnapshotNodeIds.has(nodeId)) {
          node.text = [];
        }
      }
      applyText(
        context.allActive.filter((fact) => {
          const nodeId = textNodeId(fact);
          return nodeId !== null && context.managedTextReplayNodeIds.has(nodeId);
        }),
        context.nodes,
      );
      applyText(
        context.active.filter((fact) => {
          const nodeId = textNodeId(fact);
          return nodeId === null || !context.managedTextReplayNodeIds.has(nodeId);
        }),
        context.nodes,
      );
    }),
  },
  {
    key: "value",
    dependencies: ["activation"],
    writes: ["values"],
    evaluate: evaluated("value", (context) => {
      context.addressedValues = applyValues(
        context.replayAllActive ? context.allActive : context.active,
        context.replayAllActive ? {} : context.addressedValues,
      );
    }),
  },
  {
    key: "canonical",
    dependencies: ["node", "occurrence"],
    writes: ["stored-canonicals"],
    evaluate: evaluated("canonical", (context) => {
      context.canonicalOccurrences = normalizedCanonicals(
        context.replayAllActive ? {} : context.canonicalOccurrences,
        context.replayAllActive ? context.allActive : context.active,
        context.nodes,
        context.occurrences,
      );
    }),
  },
  {
    key: "schema",
    dependencies: ["value", "occurrence", "canonical"],
    writes: ["schema-relations", "effective-fields", "materialized-fields"],
    evaluate: evaluated("schema", (context) => {
      const initializedFields = projectInitializedFields(
        context.allActive,
        context.nodes,
        context.occurrences,
        context.children,
        context.canonicalOccurrences,
      );
      const relations = deriveSchemaRelations(
        context.allActive,
        new Set(context.nodes.keys()),
        knownNodeIds(context.allActive),
        context.occurrences,
        context.children,
        initializedFields,
      );
      context.schemaApplications = relations.schemaApplications;
      context.schemaFields = relations.schemaFields;
      context.schemaFieldItems = relations.schemaFieldItems;
      context.schemaTemplateNodes = relations.schemaTemplateNodes;
      context.schemaExtensions = relations.schemaExtensions;
      context.schemaSearchMembers = relations.schemaSearchMembers;
      context.schemaExtensionConflicts = relations.schemaExtensionConflicts;
      context.definitionStatuses = projectDefinitionStatuses(
        context.allActive,
        new Set(context.nodes.keys()),
        nodeDeletionFactIds(context.allActive),
      );
      context.conflictIssues = projectConflictIssues(
        context.snapshot,
        relations.schemaExtensionConflicts,
        relations.schemaFieldItems,
        relations.effectiveFields,
        context.allActive,
        context.occurrences,
      );
      context.effectiveFields = relations.effectiveFields;
      context.materializedFields = relations.materializedFields;
      const rebuiltManagedNodeIds = new Set<string>();
      for (const instance of context.templateNodeInstances) {
        if (instance.instanceNodeId !== null) {
          rebuiltManagedNodeIds.add(instance.instanceNodeId);
        }
      }
      if (context.incremental) {
        context.canonicalOccurrences = removeTemplateNodeOutputs(
          context.templateNodeInstances,
          context.nodes,
          context.occurrences,
          context.children,
          context.canonicalOccurrences,
        );
        context.templateNodeInstances = [];
      }
      context.templateNodeInstances = projectTemplateNodeInstances(
        context.allActive,
        context.schemaApplications,
        context.schemaTemplateNodes,
        context.schemaExtensions,
        context.nodes,
        context.occurrences,
        context.children,
        context.canonicalOccurrences,
      );
      for (const instance of context.templateNodeInstances) {
        if (instance.instanceNodeId !== null) {
          rebuiltManagedNodeIds.add(instance.instanceNodeId);
        }
      }
      context.managedTextReplayNodeIds = rebuiltManagedNodeIds;
      context.canonicalOccurrences = normalizedCanonicals(
        context.canonicalOccurrences,
        context.allActive,
        context.nodes,
        context.occurrences,
      );
    }),
  },
  {
    key: "assembly",
    dependencies: ["text", "schema", "canonical"],
    writes: ["projection"],
    evaluate: evaluated("assembly", (context) => {
      validateStoredTree(context.occurrences);
      context.supportByContribution = context.ownerCache.supportByContribution;
      if (!context.incremental) {
        context.reviewScopes =
          context.view === "review"
            ? Object.fromEntries(
                [
                  ...reviewPaginationScopes(
                    pendingProposalFacts(context.snapshot),
                    (occurrenceId) => context.occurrences.get(occurrenceId)?.nodeId ?? null,
                  ),
                ].map(([identity, facts]) => [identity, facts.map((fact) => fact.id)]),
              )
            : {};
      }
      context.projection = assembleProjection(context);
    }),
  },
]);
function textNodeId(fact: ContributionFact): string | null {
  const mutation = fact.body.mutation;
  return mutation.kind === "text-splice" || mutation.kind === "text-mark" ? mutation.nodeId : null;
}
