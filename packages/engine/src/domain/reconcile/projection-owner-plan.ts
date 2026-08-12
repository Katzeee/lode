import { type ContributionFact, type FactSnapshot, type ViewMode } from "../fact/index.js";
import { compileOwnerDag, type OwnerKey } from "./owner-dag.js";
import {
  activeContributions,
  activeFactsFromCache,
  incrementalOwnerCache,
} from "./projection-active.js";
import { applyText, applyValues, deriveManagedChildren } from "./projection-content.js";
import { createNodes, createOccurrences, validateStoredTree } from "./projection-state.js";
import { normalizedCanonicals, removeManagedOutputs } from "./projection-canonicals.js";
import type { Projection, ProjectionOwnerCache, ProjectionVersions } from "./projection-types.js";
import { assembleProjection } from "./projection-value-assembly.js";
import {
  emptyOwnerContext,
  incrementalOwnerContext,
  type ProjectionOwnerContext,
  type ProjectionOwnerObserver,
} from "./projection-owner-context.js";

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
        context.ownerCache = incrementalOwnerCache(context.previousOwnerCache, context.active);
        context.allActive = context.requiresAllActive
          ? activeFactsFromCache(context.snapshot, context.previousOwnerCache, context.active)
          : context.active;
        return;
      }
      const activation = activeContributions(context.snapshot, context.view);
      context.active = activation.facts;
      context.allActive = activation.facts;
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
          node.text = [];
        }
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
    writes: [
      "managed-nodes",
      "managed-occurrences",
      "managed-children-sequences",
      "managed-canonicals",
      "managed-children",
    ],
    evaluate: evaluated("schema", (context) => {
      const rebuiltManagedNodeIds = new Set(context.managedChildren.map((child) => child.nodeId));
      if (context.incremental) {
        context.canonicalOccurrences = removeManagedOutputs(
          context.managedChildren,
          context.nodes,
          context.occurrences,
          context.children,
          context.canonicalOccurrences,
        );
        context.managedChildren = [];
      }
      context.managedChildren = deriveManagedChildren(
        context.nodes,
        context.occurrences,
        context.children,
        context.canonicalOccurrences,
        context.addressedValues,
        context.allActive,
      );
      for (const child of context.managedChildren) {
        rebuiltManagedNodeIds.add(child.nodeId);
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
      context.projection = assembleProjection(context);
    }),
  },
]);
export function projectWithOwnerPlan(
  workspaceId: string,
  snapshot: FactSnapshot,
  view: ViewMode,
  versions: ProjectionVersions,
  observer?: ProjectionOwnerObserver,
): Readonly<{
  projection: Projection;
  ownerCache: ProjectionOwnerCache;
  evaluatedOwners: readonly OwnerKey[];
}> {
  const context = emptyOwnerContext(workspaceId, snapshot, view, versions, observer);
  const evaluatedOwners = PROJECTION_OWNER_DAG.run(context);
  if (!context.projection) {
    throw new Error("Projection owner plan did not assemble a Projection");
  }
  return { projection: context.projection, ownerCache: context.ownerCache, evaluatedOwners };
}
export function advanceWithOwnerPlan(
  workspaceId: string,
  previous: Projection,
  previousCache: ProjectionOwnerCache,
  snapshot: FactSnapshot,
  activeTail: readonly ContributionFact[],
  versions: ProjectionVersions,
  selected: ReadonlySet<OwnerKey>,
  observer?: ProjectionOwnerObserver,
): Readonly<{
  projection: Projection;
  ownerCache: ProjectionOwnerCache;
  evaluatedOwners: readonly OwnerKey[];
}> {
  const context = incrementalOwnerContext(
    workspaceId,
    previous,
    previousCache,
    snapshot,
    activeTail,
    versions,
    selected,
    observer,
  );
  const evaluatedOwners = PROJECTION_OWNER_DAG.run(context, selected);
  if (!context.projection) {
    throw new Error("Incremental owner plan did not assemble a Projection");
  }
  return { projection: context.projection, ownerCache: context.ownerCache, evaluatedOwners };
}
function textNodeId(fact: ContributionFact): string | null {
  const mutation = fact.body.mutation;
  return mutation.kind === "text-splice" || mutation.kind === "text-mark" ? mutation.nodeId : null;
}
