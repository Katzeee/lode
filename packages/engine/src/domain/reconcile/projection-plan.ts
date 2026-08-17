import { compileProjectionPlan, type ProjectionArtifactKey, type ProjectionStageKey } from "./projection-plan-dag.js";
import { projectionInvalidationFor, projectionReplayPolicyFor, projectionRule } from "./projection-rule.js";
import { activeContributions, activeFactsFromCache, incrementalPlanCache } from "./projection-active.js";
import type { ContributionFact } from "../fact/index.js";
import { applyContent } from "./projection-content.js";
import { createOccurrences } from "./projection-state.js";
import { cloneNodes, createNodes } from "./node-state.js";
import { projectNodeOwners } from "./node-ownership.js";
import { assembleProjectionArtifacts } from "./projection-value-assembly.js";
import { deriveSupertagRelations, supertagApplicationTargets } from "./supertag-relations.js";
import { projectConflictIssues } from "./projection-conflicts.js";
import type { ProjectionPlanContext } from "./projection-plan-context.js";
import { excludePurgedContributions, purgedNodeIds } from "../maintenance/index.js";
import { projectTemplateStructure } from "./template-node-projection.js";
import { projectNodeGraphStructure } from "./node-graph-structure.js";
import { isPresentNodeOutsideTrash } from "./node-graph.js";
import { projectMetanodes } from "./metanodes.js";
import { projectSearchExpressions } from "./search-expressions.js";
import { viewProjectionRule } from "./projection-view-rule.js";
import { fieldDefinitionProjectionRule } from "./projection-field-definition-rule.js";

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
      const activation = activeContributions(context.snapshot, context.perspective);
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
    invalidatedBy: ["node-create", "node-delete", "node-restore", "template-node-detach"],
    evaluate: (context) => ({
      storedNodes: createNodes(context.replayAllActive ? context.activation.allActive : context.activation.active),
    }),
  }),
  projectionRule({
    key: "configuration",
    dependencies: ["activation", "node"],
    factScope: "history",
    invalidatedBy: ["metanode-attach"],
    evaluate: (context) => ({
      metanodes: projectMetanodes(context.activation.allActive, new Set(context.storedNodes.keys())),
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
      "supertag-template-node-add",
      "supertag-template-node-remove",
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
    key: "content",
    dependencies: ["activation", "node"],
    factScope: "tail",
    invalidatedBy: [
      "text-splice",
      "text-mark",
      "inline-reference-create",
      "inline-reference-delete",
      "inline-reference-alias-attach",
      "inline-reference-alias-detach",
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
    key: "owner",
    dependencies: ["activation", "node"],
    factScope: "history",
    invalidatedBy: ["node-owner-set"],
    evaluate: (context) => ({
      nodeOwners: projectNodeOwners(context.workspaceNodeId, context.activation.allActive, context.storedNodes),
    }),
  }),
  projectionRule({
    key: "node-graph",
    dependencies: ["activation", "occurrence", "owner", "configuration"],
    factScope: "history",
    invalidatedBy: [],
    evaluate: (context) => ({
      nodeGraphStructure: projectNodeGraphStructure(
        context.workspaceNodeId,
        context.authoredStructure.occurrences,
        context.authoredStructure.childOccurrences,
        context.nodeOwners,
        context.metanodes,
      ),
    }),
  }),
  projectionRule({
    key: "supertag-relations",
    dependencies: ["activation", "node", "content", "node-graph"],
    factScope: "history",
    invalidatedBy: [
      "intrinsic-node-type-declare",
      "supertag-apply",
      "supertag-remove",
      "supertag-extension-add",
      "supertag-extension-remove",
      "supertag-template-field-attach",
      "supertag-template-field-existing-attach",
      "supertag-template-field-detach",
      "supertag-template-field-discoverability-set",
      "supertag-template-field-visibility-configure",
      "supertag-optional-field-contribution-attach",
      "supertag-optional-field-contribution-detach",
      "field-materialize",
      "text-splice",
    ],
    evaluate(context) {
      const effectiveNodes = Object.fromEntries(context.contentNodes);
      const activeNodeIds = new Set(
        [...context.storedNodes.keys()].filter((nodeId) =>
          isPresentNodeOutsideTrash(
            context.workspaceNodeId,
            {
              nodes: effectiveNodes,
              nodeOwners: context.nodeGraphStructure.nodeOwners,
              workspaceSystemNodes: context.nodeGraphStructure.workspaceSystemNodes,
            },
            nodeId,
          ),
        ),
      );
      return {
        supertagRelations: deriveSupertagRelations(
          context.activation.allActive,
          context.workspaceNodeId,
          effectiveNodes,
          activeNodeIds,
          knownNodeIds(context.activation.allActive),
          context.nodeGraphStructure.occurrences,
          context.nodeGraphStructure.childOccurrences,
          context.nodeGraphStructure.metanodes,
          context.nodeGraphStructure.nodeOwners,
        ),
      };
    },
  }),
  fieldDefinitionProjectionRule,
  projectionRule({
    key: "search",
    dependencies: ["activation", "node", "node-graph"],
    factScope: "history",
    invalidatedBy: ["search-expression-attach", "search-expression-detach"],
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

function knownNodeIds(active: readonly ContributionFact[]): ReadonlySet<string> {
  return new Set(
    active.flatMap((fact) => {
      const mutation = fact.body.mutation;
      return mutation.kind === "node-create" ? [mutation.nodeId] : [];
    }),
  );
}
