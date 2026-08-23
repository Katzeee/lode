import {
  compareCausalOrder,
  factObserves,
  type FactAction,
  type FactActionId,
  type IntrinsicNodeType,
} from "../fact/index.js";
import type { InlineReferenceId } from "../fact/index.js";
import { placeCreatedOccurrence } from "./occurrence-creation.js";
import {
  createPlacementProjectionContext,
  isPlacementRemovalAction,
  placementCreationForAction,
  placementIdsForAction,
  type PlacementProjectionContext,
} from "./projection-placement.js";
import type { TextAtom } from "./projection-types.js";
import { removePlacement } from "./sequence.js";

export type MutableOccurrence = {
  occurrenceId: string;
  nodeId: string;
  parentNodeId: string;
  derived: boolean;
};

export type MutableNode = {
  nodeId: string;
  intrinsicNodeType: IntrinsicNodeType | null;
  content: MutableNodeContentItem[];
};

export type MutableInlineReference = {
  kind: "inline-reference";
  id: InlineReferenceId;
  targetNodeId: string;
  aliasNodeId?: string | null;
  factActionId: FactActionId;
};

type MutableNodeContentItem = TextAtom | MutableInlineReference;

export type AuthoredStructure = Readonly<{
  occurrences: Map<string, MutableOccurrence>;
  childOccurrences: Map<string, string[]>;
}>;

export function createOccurrences(
  workspaceNodeId: string,
  active: readonly FactAction[],
  nodes: ReadonlyMap<string, MutableNode>,
): AuthoredStructure {
  const context = createPlacementProjectionContext(active);
  const actionsByPlacement = placementActions(context);
  const placements = [...actionsByPlacement].flatMap(([placementId, actions]) => {
    const removalActions = actions.filter((action) => isPlacementRemovalAction(action));
    const liveCreates = actions.filter(
      (action) =>
        placementCreationForAction(workspaceNodeId, action, placementId, context) !== null &&
        !removalActions.some((removal) => actionObserves(removal, action)),
    );
    if (liveCreates.length === 0) {
      return [];
    }
    const moves = actions.filter(
      (action) =>
        action.action.kind === "placement-move" &&
        !removalActions.some((removal) => actionObserves(removal, action)) &&
        liveCreates.some((create) => actionObserves(action, create)),
    );
    const candidates = [...liveCreates]
      .sort((left, right) => compareCausalOrder(right, left))
      .flatMap((create) => {
        const creation = placementCreationForAction(workspaceNodeId, create, placementId, context);
        if (!creation) {
          return [];
        }
        return [...moves.filter((move) => actionObserves(move, create)), create]
          .sort((left, right) => compareCausalOrder(right, left))
          .flatMap((position) => {
            const value = placementPosition(workspaceNodeId, position, placementId, context);
            return value
              ? [
                  {
                    action: {
                      kind: "placement-create" as const,
                      placementId,
                      nodeId: creation.nodeId,
                      parentNodeId: value.parentNodeId,
                      anchor: value.anchor,
                    },
                    order: position,
                    derived: creation.derived,
                  },
                ]
              : [];
          });
      });
    return [
      {
        candidates,
        candidateIndex: 0,
      },
    ];
  });

  while (true) {
    const occurrences = new Map<string, MutableOccurrence>();
    const childOccurrences = new Map<string, string[]>();
    let retry = false;
    const ordered = placements
      .flatMap((placement) => {
        const candidate = placement.candidates[placement.candidateIndex];
        return candidate ? [{ placement, candidate }] : [];
      })
      .sort((left, right) => compareCausalOrder(left.candidate.order, right.candidate.order));
    for (const { placement, candidate } of ordered) {
      if (!placeCreatedOccurrence(candidate.action, occurrences, childOccurrences, nodes)) {
        placement.candidateIndex += 1;
        retry = true;
        break;
      }
      const occurrence = occurrences.get(candidate.action.placementId);
      if (occurrence) {
        occurrence.derived = candidate.derived;
      }
    }
    if (!retry) {
      removeOccurrencesWithMissingNodes(nodes, occurrences, childOccurrences);
      return { occurrences, childOccurrences };
    }
  }
}

function removeOccurrencesWithMissingNodes(
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: Map<string, MutableOccurrence>,
  childOccurrences: Map<string, string[]>,
): void {
  for (const [occurrenceId, occurrence] of occurrences) {
    if (!nodes.has(occurrence.nodeId)) {
      deleteOccurrence(occurrenceId, occurrences, childOccurrences);
    }
  }
}

function placementActions(context: PlacementProjectionContext): ReadonlyMap<string, readonly FactAction[]> {
  const result = new Map<string, FactAction[]>();
  for (const action of context.active) {
    for (const placementId of placementIdsForAction(action, context)) {
      const actions = result.get(placementId) ?? [];
      actions.push(action);
      result.set(placementId, actions);
    }
  }
  return result;
}

function placementPosition(
  workspaceNodeId: string,
  action: FactAction,
  placementId: string,
  context: PlacementProjectionContext,
): Readonly<{
  parentNodeId: string;
  anchor: Extract<FactAction["action"], { kind: "placement-create" }>["anchor"];
}> | null {
  const creation = placementCreationForAction(workspaceNodeId, action, placementId, context);
  if (creation) {
    return creation;
  }
  const authoredAction = action.action;
  return authoredAction.kind === "placement-move"
    ? { parentNodeId: authoredAction.parentNodeId, anchor: authoredAction.anchor }
    : null;
}

function actionObserves(observer: FactAction, observed: FactAction): boolean {
  return observer.factId === observed.factId ? observer.index > observed.index : factObserves(observer, observed);
}

function deleteOccurrence(
  occurrenceId: string,
  occurrences: Map<string, MutableOccurrence>,
  childOccurrences: Map<string, string[]>,
): void {
  removePlacement(childOccurrences, occurrenceId);
  occurrences.delete(occurrenceId);
}
