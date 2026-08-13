import { type ContributionFact } from "../fact/index.js";
import { compileProjectionPlan, type ProjectionStageKey } from "./projection-plan-dag.js";
import {
  activeContributions,
  activeFactsFromCache,
  incrementalPlanCache,
} from "./projection-active.js";
import { applyText, applyValues } from "./projection-content.js";
import { createOccurrences } from "./projection-state.js";
import { createNodes } from "./node-state.js";
import { validateStoredTree } from "./occurrence-tree.js";
import { projectNodeOwners } from "./node-ownership.js";
import { assembleProjection } from "./projection-value-assembly.js";
import { deriveSchemaRelations } from "./schema-relations.js";
import { projectConflictIssues } from "./projection-conflicts.js";
import { projectInitializedFields } from "./initialized-field.js";
import type { ProjectionPlanContext } from "./projection-plan-context.js";
import { projectNodeStatuses } from "./node-status.js";
import { knownNodeIds, nodeDeletionFactIds } from "./node-lifecycle.js";
import { excludePurgedContributions, purgedNodeIds } from "./maintenance-projection.js";
import {
  projectTemplateNodeInstances,
  removeTemplateNodeOutputs,
} from "./template-node-projection.js";
import { pendingProposalFacts } from "../review/evidence.js";
import { reviewPaginationScopes } from "../review/pagination-scopes.js";

export type { ProjectionStageObserver } from "./projection-plan-context.js";
function evaluated(
  key: ProjectionStageKey,
  evaluate: (context: ProjectionPlanContext) => void,
): (context: ProjectionPlanContext) => void {
  return (context) => {
    context.observer?.(key, context.view);
    evaluate(context);
  };
}
export const PROJECTION_PLAN = compileProjectionPlan<ProjectionPlanContext>([
  {
    key: "activation",
    dependencies: [],
    writes: ["active-contributions", "support-index"],
    evaluate: evaluated("activation", (context) => {
      if (context.incremental) {
        context.planCache = incrementalPlanCache(
          context.previousPlanCache,
          context.active,
          context.snapshot,
        );
        context.allActive = context.requiresAllActive
          ? activeFactsFromCache(context.snapshot, context.previousPlanCache, context.active)
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
      context.planCache = activation.cache;
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
        applyText(context.allActive, context.nodes);
        return;
      }
      for (const nodeId of context.managedTextReplayNodeIds) {
        const node = context.nodes.get(nodeId);
        if (node) {
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
    key: "owner",
    dependencies: ["node", "occurrence"],
    writes: ["node-owners"],
    evaluate: evaluated("owner", (context) => {
      context.nodeOwners = projectNodeOwners(
        context.workspaceNodeId,
        context.replayAllActive ? {} : context.nodeOwners,
        context.replayAllActive ? context.allActive : context.active,
        context.nodes,
        context.occurrences,
      );
    }),
  },
  {
    key: "schema",
    dependencies: ["value", "occurrence", "owner"],
    writes: ["schema-relations", "effective-fields", "materialized-fields"],
    evaluate: evaluated("schema", (context) => {
      const initializedFields = projectInitializedFields(
        context.allActive,
        context.nodes,
        context.occurrences,
        context.nodeOwners,
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
      context.templateFields = relations.templateFields;
      context.schemaTemplateNodes = relations.schemaTemplateNodes;
      context.schemaExtensions = relations.schemaExtensions;
      context.schemaSearchMembers = relations.schemaSearchMembers;
      context.schemaExtensionConflicts = relations.schemaExtensionConflicts;
      context.nodeStatuses = projectNodeStatuses(
        context.allActive,
        knownNodeIds(context.allActive),
        new Set(Object.keys(context.nodeOwners)),
        nodeDeletionFactIds(context.allActive),
      );
      context.conflictIssues = projectConflictIssues(
        context.snapshot,
        relations.schemaExtensionConflicts,
        relations.templateFields,
        relations.effectiveFields,
        context.allActive,
        context.occurrences,
      );
      context.effectiveFields = relations.effectiveFields;
      context.materializedFields = relations.materializedFields;
      if (context.incremental) {
        context.nodeOwners = removeTemplateNodeOutputs(
          context.templateNodeInstances,
          context.occurrences,
          context.children,
          context.nodeOwners,
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
        context.nodeOwners,
      );
      context.managedTextReplayNodeIds = new Set();
      context.nodeOwners = projectNodeOwners(
        context.workspaceNodeId,
        context.nodeOwners,
        context.allActive,
        context.nodes,
        context.occurrences,
      );
    }),
  },
  {
    key: "assembly",
    dependencies: ["text", "schema", "owner"],
    writes: ["projection"],
    evaluate: evaluated("assembly", (context) => {
      validateStoredTree(context.nodes, context.occurrences);
      context.supportByContribution = context.planCache.supportByContribution;
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
