import { compileProjectionPlan, type ProjectionArtifactKey, type ProjectionStageKey } from "./projection-plan-dag.js";
import { projectionInvalidationFor, projectionReplayPolicyFor, projectionRule } from "./projection-rule.js";
import { activeContributions, activeFactsFromCache, incrementalPlanCache } from "./projection-active.js";
import type { ContributionFact } from "../fact/index.js";
import { applyText, applyValues } from "./projection-content.js";
import { createOccurrences } from "./projection-state.js";
import { cloneNodes, createNodes } from "./node-state.js";
import { projectNodeOwners } from "./node-ownership.js";
import { assembleProjectionArtifacts } from "./projection-value-assembly.js";
import { deriveSchemaRelations } from "./schema-relations.js";
import { projectConflictIssues } from "./projection-conflicts.js";
import { projectInitializedFields } from "./initialized-field.js";
import type { ProjectionPlanContext } from "./projection-plan-context.js";
import { projectNodeStatuses } from "./node-status.js";
import { excludePurgedContributions, nodeDeletionFactIds, purgedNodeIds } from "../maintenance/index.js";
import { projectTemplateStructure } from "./template-node-projection.js";

const PROJECTION_RULES = [
  projectionRule({
    key: "activation",
    dependencies: [],
    factScope: "tail",
    invalidatedBy: [],
    evaluate(context) {
      if (context.incremental) {
        const planCache = incrementalPlanCache(context.previousPlanCache, context.activeTail, context.snapshot);
        const allActive = context.requiresAllActive
          ? activeFactsFromCache(context.snapshot, context.previousPlanCache, context.activeTail)
          : context.activeTail;
        const purged = purgedNodeIds(context.snapshot.facts);
        return {
          activation: {
            active: excludePurgedContributions(context.activeTail, purged),
            allActive: excludePurgedContributions(allActive, purged),
            planCache,
          },
        };
      }
      const activation = activeContributions(context.snapshot, context.view);
      const purged = purgedNodeIds(context.snapshot.facts);
      const active = excludePurgedContributions(activation.facts, purged);
      return {
        activation: { active, allActive: active, planCache: activation.cache },
      };
    },
  }),
  projectionRule({
    key: "node",
    dependencies: ["activation"],
    factScope: "rebuild",
    invalidatedBy: [
      "node-create",
      "node-delete",
      "node-restore",
      "schema-field-add",
      "template-node-detach",
      "field-initialize",
    ],
    evaluate: (context) => ({
      storedNodes: createNodes(context.replayAllActive ? context.activation.allActive : context.activation.active),
    }),
  }),
  projectionRule({
    key: "occurrence",
    dependencies: ["activation", "node"],
    factScope: "rebuild",
    invalidatedBy: [
      "occurrence-create",
      "occurrence-delete",
      "occurrence-restore",
      "occurrence-move",
      "field-value-delete",
      "materialized-field-delete",
      "schema-field-remove",
      "schema-template-node-add",
      "schema-template-node-remove",
    ],
    evaluate(context) {
      return {
        authoredStructure: createOccurrences(
          context.replayAllActive ? context.activation.allActive : context.activation.active,
          context.storedNodes,
        ),
      };
    },
  }),
  projectionRule({
    key: "text",
    dependencies: ["activation", "node"],
    factScope: "tail",
    invalidatedBy: ["text-splice", "text-mark"],
    evaluate(context) {
      const replayAllText = !context.incremental || context.replayAllActive;
      const source = replayAllText ? context.storedNodes : context.contentNodes;
      const contentNodes = cloneNodes(source);
      applyText(replayAllText ? context.activation.allActive : context.activation.active, contentNodes);
      return { contentNodes };
    },
  }),
  projectionRule({
    key: "value",
    dependencies: ["activation"],
    factScope: "tail",
    invalidatedBy: ["value-set", "value-unset"],
    evaluate: (context) => ({
      addressedValues: applyValues(
        context.replayAllActive ? context.activation.allActive : context.activation.active,
        context.replayAllActive ? {} : context.addressedValues,
      ),
    }),
  }),
  projectionRule({
    key: "owner",
    dependencies: ["activation", "node", "occurrence"],
    factScope: "history",
    invalidatedBy: ["node-owner-set"],
    evaluate: (context) => ({
      nodeOwners: projectNodeOwners(
        context.workspaceNodeId,
        context.activation.allActive,
        context.storedNodes,
        context.authoredStructure.occurrences,
      ),
    }),
  }),
  projectionRule({
    key: "schema-relations",
    dependencies: ["activation", "node", "value", "occurrence", "owner"],
    factScope: "history",
    invalidatedBy: [
      "node-type-declare",
      "schema-apply",
      "schema-remove",
      "schema-field-configure",
      "schema-extension-add",
      "schema-extension-remove",
      "field-materialize",
    ],
    evaluate(context) {
      const initializedFields = projectInitializedFields(
        context.activation.allActive,
        context.storedNodes,
        context.authoredStructure.occurrences,
        context.nodeOwners,
      );
      return {
        schemaRelations: deriveSchemaRelations(
          context.activation.allActive,
          new Set(context.storedNodes.keys()),
          knownNodeIds(context.activation.allActive),
          context.authoredStructure.occurrences,
          context.authoredStructure.children,
          initializedFields,
        ),
      };
    },
  }),
  projectionRule({
    key: "node-status",
    dependencies: ["activation", "owner"],
    factScope: "history",
    invalidatedBy: ["node-type-declare"],
    evaluate: (context) => ({
      nodeStatuses: projectNodeStatuses(
        context.activation.allActive,
        knownNodeIds(context.activation.allActive),
        new Set(Object.keys(context.nodeOwners)),
        nodeDeletionFactIds(context.activation.allActive),
      ),
    }),
  }),
  projectionRule({
    key: "conflict",
    dependencies: ["activation", "occurrence", "schema-relations"],
    factScope: "history",
    invalidatedBy: [],
    evaluate: (context) => ({
      conflictIssues: projectConflictIssues(
        context.snapshot,
        context.schemaRelations.schemaExtensionConflicts,
        context.schemaRelations.templateFields,
        context.schemaRelations.effectiveFields,
        context.activation.allActive,
        context.authoredStructure.occurrences,
      ),
    }),
  }),
  projectionRule({
    key: "template",
    dependencies: ["activation", "node", "occurrence", "owner", "schema-relations"],
    factScope: "history",
    invalidatedBy: [],
    evaluate(context) {
      return {
        templateStructure: projectTemplateStructure(
          context.activation.allActive,
          context.schemaRelations.schemaApplications,
          context.schemaRelations.schemaTemplateNodes,
          context.schemaRelations.schemaExtensions,
          context.storedNodes,
          context.authoredStructure.occurrences,
          context.authoredStructure.children,
          context.nodeOwners,
        ),
      };
    },
  }),
  projectionRule({
    key: "assembly",
    dependencies: ["node", "text", "value", "owner", "schema-relations", "node-status", "conflict", "template"],
    factScope: "tail",
    invalidatedBy: [],
    evaluate: (context) => ({ projection: assembleProjectionArtifacts(context) }),
  }),
];

export const PROJECTION_PLAN = compileProjectionPlan<ProjectionPlanContext, ProjectionStageKey, ProjectionArtifactKey>(
  PROJECTION_RULES,
);

export const invalidatedProjectionStages = projectionInvalidationFor(PROJECTION_RULES);
export const projectionReplayPolicy = projectionReplayPolicyFor(PROJECTION_RULES);

function knownNodeIds(active: readonly ContributionFact[]): ReadonlySet<string> {
  return new Set(
    active.flatMap((fact) => {
      const mutation = fact.body.mutation;
      return mutation.kind === "node-create" ? [mutation.nodeId] : [];
    }),
  );
}
