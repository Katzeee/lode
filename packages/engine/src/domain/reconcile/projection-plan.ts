import { compileProjectionPlan, type ProjectionArtifactKey, type ProjectionStageKey } from "./projection-plan-dag.js";
import { projectionInvalidationFor, projectionReplayPolicyFor, projectionRule } from "./projection-rule.js";
import { activeFactActions, activeActionsFromCache, incrementalPlanCache } from "./projection-active.js";
import { factActionsFromFacts } from "../fact/index.js";
import { applyContent } from "./projection-content.js";
import { createOccurrences } from "./projection-state.js";
import { cloneNodes, createNodes } from "./node-state.js";
import { assembleProjectionArtifacts } from "./projection-value-assembly.js";
import { supertagApplicationTargets } from "./supertag-relations.js";
import { projectConflictIssues } from "./projection-conflicts.js";
import type { ProjectionPlanContext } from "./projection-plan-context.js";
import { excludePurgedActions, purgedNodeIds } from "../maintenance/index.js";
import { projectTemplateStructure } from "./template-node-projection.js";
import { projectNodeGraphStructure } from "./node-graph-structure.js";
import { projectMetanodes } from "./metanodes.js";
import { projectSearchExpressions } from "./search-expressions.js";
import { viewProjectionRule } from "./projection-view-rule.js";
import { fieldDefinitionProjectionRule } from "./projection-field-definition-rule.js";
import { supertagProjectionRule } from "./projection-supertag-rule.js";

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
          ? activeActionsFromCache(context.snapshot, context.previousPlanCache, context.activeTail)
          : context.activeTail;
        const purged = purgedNodeIds(context.snapshot.facts);
        return {
          activation: {
            active: excludePurgedActions(context.activeTail, purged),
            allActive: excludePurgedActions(allActive, purged),
            planCache,
          },
        };
      }
      const activation = activeFactActions(context.snapshot, context.perspective);
      const purged = purgedNodeIds(context.snapshot.facts);
      const active = excludePurgedActions(activation.actions, purged);
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
      "workspace-bootstrap",
      "node-create",
      "node-trash",
      "node-restore",
      "template-node-detach",
      "supertag-application-add",
      "supertag-membership-remove",
      "search-expression-add",
      "shared-default-view-add",
      "shared-default-view-remove",
      "view-filter-add",
      "template-field-add",
      "template-field-static-default-set",
      "optional-field-contribution-add",
      "optional-field-contribution-remove",
    ],
    evaluate: (context) => ({
      storedNodes: createNodes(context.replayAllActive ? context.activation.allActive : context.activation.active),
    }),
  }),
  projectionRule({
    key: "configuration",
    dependencies: ["activation", "node"],
    factScope: "history",
    invalidatedBy: [
      "supertag-application-add",
      "search-expression-add",
      "shared-default-view-add",
      "optional-field-contribution-add",
    ],
    evaluate: (context) => ({
      metanodes: projectMetanodes(context.activation.allActive, new Set(context.storedNodes.keys())),
    }),
  }),
  projectionRule({
    key: "occurrence",
    dependencies: ["activation", "node"],
    factScope: "rebuild",
    invalidatedBy: [
      "placement-create",
      "placement-remove",
      "placement-move",
      "field-value-remove",
      "materialized-field-clear",
      "template-member-add",
      "template-member-remove",
      "supertag-application-add",
      "supertag-membership-remove",
      "template-field-add",
      "template-field-remove",
      "template-field-restore",
      "field-definition-make-discoverable",
      "field-definition-return-to-template-field",
      "optional-field-contribution-add",
      "optional-field-contribution-remove",
      "search-expression-add",
      "search-expression-configure",
      "search-expression-move",
      "search-expression-remove",
      "search-expression-restore",
      "shared-default-view-add",
      "shared-default-view-remove",
      "shared-default-view-restore",
    ],
    evaluate(context) {
      return {
        authoredStructure: createOccurrences(
          context.workspaceNodeId,
          context.replayAllActive ? context.activation.allActive : context.activation.active,
          context.storedNodes,
        ),
      };
    },
  }),
  projectionRule({
    key: "content",
    dependencies: ["activation", "node"],
    factScope: "tail",
    invalidatedBy: [
      "rich-text-splice",
      "rich-text-mark",
      "inline-reference-create",
      "inline-reference-remove",
      "inline-alias-attach",
      "inline-alias-detach",
    ],
    evaluate(context) {
      const replayAllContent = !context.incremental || context.replayAllActive;
      const source = replayAllContent ? context.storedNodes : context.contentNodes;
      const contentNodes = cloneNodes(source);
      applyContent(replayAllContent ? context.activation.allActive : context.activation.active, contentNodes);
      return { contentNodes };
    },
  }),
  projectionRule({
    key: "node-graph",
    dependencies: ["activation", "node", "occurrence", "configuration"],
    factScope: "history",
    invalidatedBy: [
      "node-create",
      "node-restore",
      "original-promote",
      "supertag-membership-remove",
      "template-field-add",
      "template-field-remove",
      "template-field-restore",
      "field-definition-make-discoverable",
      "field-definition-return-to-template-field",
      "optional-field-contribution-add",
      "optional-field-contribution-remove",
      "search-expression-add",
      "search-expression-configure",
      "search-expression-move",
      "search-expression-remove",
      "search-expression-restore",
      "shared-default-view-add",
      "shared-default-view-remove",
      "shared-default-view-restore",
      "view-filter-add",
      "view-filter-remove",
      "view-filter-restore",
    ],
    evaluate: (context) => ({
      nodeGraphStructure: projectNodeGraphStructure(
        context.workspaceNodeId,
        context.activation.allActive,
        context.authoredStructure.occurrences,
        context.authoredStructure.childOccurrences,
        context.storedNodes,
        context.metanodes,
      ),
    }),
  }),
  supertagProjectionRule,
  fieldDefinitionProjectionRule,
  projectionRule({
    key: "search",
    dependencies: ["activation", "node", "node-graph"],
    factScope: "history",
    invalidatedBy: [
      "search-expression-add",
      "search-expression-configure",
      "search-expression-move",
      "search-expression-remove",
      "search-expression-restore",
    ],
    evaluate: (context) => ({
      searchExpressions: projectSearchExpressions(
        context.workspaceNodeId,
        context.activation.allActive,
        context.storedNodes,
        context.nodeGraphStructure.occurrences,
        context.nodeGraphStructure.childOccurrences,
        context.nodeGraphStructure.nodeOwners,
        context.nodeGraphStructure.metanodes,
        context.nodeGraphStructure.workspaceSystemNodes,
      ),
    }),
  }),
  viewProjectionRule,
  projectionRule({
    key: "conflict",
    dependencies: ["activation", "node-graph", "supertag-relations"],
    factScope: "history",
    invalidatedBy: [],
    evaluate: (context) => ({
      conflictIssues: projectConflictIssues(
        context.snapshot,
        context.supertagRelations.supertagExtensionConflicts,
        context.activation.allActive,
        context.nodeGraphStructure.occurrences,
        context.nodeGraphStructure.nodeOwners,
        context.originPlanCache ?? context.activation.planCache,
      ),
    }),
  }),
  projectionRule({
    key: "template",
    dependencies: ["activation", "node", "node-graph", "supertag-relations"],
    factScope: "history",
    invalidatedBy: [],
    evaluate(context) {
      return {
        templateStructure: projectTemplateStructure(
          context.activation.allActive,
          factActionsFromFacts(context.snapshot.facts),
          supertagApplicationTargets(
            context.supertagRelations.supertagApplications,
            new Set(context.storedNodes.keys()),
          ),
          context.supertagRelations.supertagTemplateNodes,
          context.supertagRelations.supertagExtensions,
          context.storedNodes,
          context.nodeGraphStructure.occurrences,
          context.nodeGraphStructure.childOccurrences,
          context.nodeGraphStructure.nodeOwners,
        ),
      };
    },
  }),
  projectionRule({
    key: "assembly",
    dependencies: [
      "activation",
      "node",
      "content",
      "node-graph",
      "supertag-relations",
      "field-definition",
      "search",
      "view",
      "conflict",
      "template",
    ],
    factScope: "tail",
    invalidatedBy: [],
    evaluate: (context) => ({
      projection: assembleProjectionArtifacts({
        ...context,
        active: context.activation.allActive.length > 0 ? context.activation.allActive : context.activation.active,
      }),
    }),
  }),
];

export const PROJECTION_PLAN = compileProjectionPlan<ProjectionPlanContext, ProjectionStageKey, ProjectionArtifactKey>(
  PROJECTION_RULES,
);

export const invalidatedProjectionStages = projectionInvalidationFor(PROJECTION_RULES);
export const projectionReplayPolicy = projectionReplayPolicyFor(PROJECTION_RULES);
