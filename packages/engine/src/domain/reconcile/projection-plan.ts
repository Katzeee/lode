import { compileProjectionPlan, type ProjectionArtifactKey, type ProjectionStageKey } from "./projection-plan-dag.js";
import { projectionRule } from "./projection-rule.js";
import { activeFactActions } from "./projection-active.js";
import { factActionsFromFacts } from "../fact/index.js";
import { applyContent } from "./projection-content.js";
import { createOccurrences } from "./projection-state.js";
import { cloneNodes, createNodes } from "./node-state.js";
import { assembleProjectionArtifacts } from "./projection-value-assembly.js";
import { supertagApplicationTargets } from "./supertag-relations.js";
import { projectConflictIssues } from "./projection-conflicts.js";
import type { ProjectionPlanContext } from "./projection-plan-context.js";
import { effectiveContributions, effectiveProjectionActivation, finalizedNodeIds } from "./deletion-finalization.js";
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
    evaluate(context) {
      const activation = activeFactActions(context.snapshot, context.perspective);
      const finalized = finalizedNodeIds(activation.actions);
      const active = effectiveContributions(activation.actions, finalized);
      return {
        activation: {
          actions: active,
          evidence: effectiveProjectionActivation(activation.activation, activation.actions, active),
        },
      };
    },
  }),
  projectionRule({
    key: "node",
    dependencies: ["activation"],
    evaluate: (context) => ({
      storedNodes: createNodes(context.activation.actions),
    }),
  }),
  projectionRule({
    key: "configuration",
    dependencies: ["activation", "node"],
    evaluate: (context) => ({
      metanodes: projectMetanodes(context.activation.actions, new Set(context.storedNodes.keys())),
    }),
  }),
  projectionRule({
    key: "occurrence",
    dependencies: ["activation", "node"],
    evaluate(context) {
      return {
        authoredStructure: createOccurrences(context.workspaceNodeId, context.activation.actions, context.storedNodes),
      };
    },
  }),
  projectionRule({
    key: "content",
    dependencies: ["activation", "node"],
    evaluate(context) {
      const contentNodes = cloneNodes(context.storedNodes);
      applyContent(context.activation.actions, contentNodes);
      return { contentNodes };
    },
  }),
  projectionRule({
    key: "node-graph",
    dependencies: ["activation", "node", "occurrence", "configuration"],
    evaluate: (context) => ({
      nodeGraphStructure: projectNodeGraphStructure(
        context.workspaceNodeId,
        context.activation.actions,
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
    evaluate: (context) => ({
      searchExpressions: projectSearchExpressions(
        context.workspaceNodeId,
        context.activation.actions,
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
    evaluate: (context) => ({
      conflictIssues: projectConflictIssues(
        context.snapshot,
        context.supertagRelations.supertagExtensionConflicts,
        context.activation.actions,
        context.nodeGraphStructure.occurrences,
        context.nodeGraphStructure.nodeOwners,
        context.originActivation ?? context.activation.evidence,
      ),
    }),
  }),
  projectionRule({
    key: "template",
    dependencies: ["activation", "node", "node-graph", "supertag-relations"],
    evaluate(context) {
      return {
        templateStructure: projectTemplateStructure(
          context.activation.actions,
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
    evaluate: (context) => ({
      projection: assembleProjectionArtifacts({
        ...context,
        active: context.activation.actions,
      }),
    }),
  }),
];

export const PROJECTION_PLAN = compileProjectionPlan<ProjectionPlanContext, ProjectionStageKey, ProjectionArtifactKey>(
  PROJECTION_RULES,
);
