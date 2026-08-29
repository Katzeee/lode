import {
  canonicalJson,
  factActionsOfKind,
  type FactAction,
  type FactActionId,
  type FactActionOf,
  type SequenceAnchor,
  type ViewSortDirection,
  type ViewType,
  NODE_VIEWS_DEFINITION_NODE_ID,
  START_SEQUENCE_ANCHOR as start,
} from "../fact/index.js";
import { causalCollectionStates } from "./causal-collection.js";
import { metanodeNodeId } from "./projection-identity.js";

type ViewProjectionIdentity = Readonly<{
  attachmentNodeId: string;
  attachmentOccurrenceId: string;
  relationDefinitionOccurrenceId: string;
  viewDefinitionNodeId: string;
  viewDefinitionOccurrenceId: string;
  detachedValueNodeId: string;
  detachedValueOccurrenceId: string;
}>;

type ViewState = Readonly<{
  addition: FactActionOf<"shared-default-view-add">;
  removed: boolean;
  viewType: ViewType;
  modeCandidates: readonly FactActionOf<"view-mode-set">[];
  modeConflicted: boolean;
  identity: ViewProjectionIdentity;
}>;

type ViewColumnState = Readonly<{
  addition: FactActionOf<"view-column-add">;
  removed: boolean;
  anchor: SequenceAnchor;
  positionConflicted: boolean;
  columnNodeId: string;
}>;

type ViewSortState = Readonly<{
  addition: FactActionOf<"view-sort-add">;
  removed: boolean;
  fieldDefinitionId: string;
  direction: ViewSortDirection;
  configurationCandidates: readonly FactActionOf<"view-sort-configure">[];
  configurationConflicted: boolean;
  sortNodeId: string;
}>;

type ViewGroupState = Readonly<{
  addition: FactActionOf<"view-group-add">;
  removed: boolean;
  groupNodeId: string;
}>;

type ViewFilterState = Readonly<{
  addition: FactActionOf<"view-filter-add">;
  removed: boolean;
  filterNodeId: string;
}>;

export function viewProjectionIdentity(viewId: FactActionId): ViewProjectionIdentity {
  const root = `${viewId}/projection/shared-default-view`;
  return {
    attachmentNodeId: `${root}/attachment-node`,
    attachmentOccurrenceId: `${root}/attachment-occurrence`,
    relationDefinitionOccurrenceId: `${root}/definition-occurrence`,
    viewDefinitionNodeId: `${root}/view-node`,
    viewDefinitionOccurrenceId: `${root}/view-occurrence`,
    detachedValueNodeId: `${root}/detached-value-node`,
    detachedValueOccurrenceId: `${root}/detached-value-occurrence`,
  };
}

export function viewColumnNodeId(columnId: FactActionId): string {
  return `${columnId}/projection/view-column/node`;
}

export function viewSortNodeId(sortId: FactActionId): string {
  return `${sortId}/projection/view-sort/node`;
}

export function viewGroupNodeId(groupId: FactActionId): string {
  return `${groupId}/projection/view-group/node`;
}

export function viewFilterNodeId(filterId: FactActionId): string {
  return `${filterId}/projection/view-filter/node`;
}

export function viewStates(active: readonly FactAction[]): readonly ViewState[] {
  return causalCollectionStates(active, "shared-default-view").map((state) => {
    const { addition, removed } = state;
    const candidates = factActionsOfKind(state.registers.get("mode")?.candidates ?? [], "view-mode-set");
    const values =
      candidates.length === 0 ? [addition.action.viewType] : candidates.map((candidate) => candidate.action.viewType);
    const unique = [...new Set(values)].sort();
    return {
      addition,
      removed,
      viewType: unique[0] ?? addition.action.viewType,
      modeCandidates: candidates,
      modeConflicted: state.registers.get("mode")?.conflicted ?? false,
      identity: viewProjectionIdentity(addition.id),
    };
  });
}

export function viewStateByAction(active: readonly FactAction[]): ReadonlyMap<FactActionId, ViewState> {
  return new Map(viewStates(active).map((state) => [state.addition.id, state]));
}

export function viewPlacementIds(action: FactAction, states: ReadonlyMap<FactActionId, ViewState>): readonly string[] {
  const state = states.get(action.id);
  if (!state) {
    return [];
  }
  return state.removed
    ? [state.identity.relationDefinitionOccurrenceId, state.identity.detachedValueOccurrenceId]
    : [
        state.identity.attachmentOccurrenceId,
        state.identity.relationDefinitionOccurrenceId,
        state.identity.viewDefinitionOccurrenceId,
      ];
}

export function viewPlacement(
  state: ViewState,
  placementId: string,
): Readonly<{ nodeId: string; parentNodeId: string; anchor: SequenceAnchor; derived: true }> | null {
  const { identity } = state;
  if (placementId === identity.relationDefinitionOccurrenceId) {
    return {
      nodeId: NODE_VIEWS_DEFINITION_NODE_ID,
      parentNodeId: identity.attachmentNodeId,
      anchor: start,
      derived: true,
    };
  }
  if (state.removed && placementId === identity.detachedValueOccurrenceId) {
    return {
      nodeId: identity.detachedValueNodeId,
      parentNodeId: identity.attachmentNodeId,
      anchor: after(identity.relationDefinitionOccurrenceId),
      derived: true,
    };
  }
  if (state.removed) {
    return null;
  }
  if (placementId === identity.attachmentOccurrenceId) {
    return {
      nodeId: identity.attachmentNodeId,
      parentNodeId: metanodeNodeId(state.addition.action.hostNodeId),
      anchor: state.addition.action.anchor,
      derived: true,
    };
  }
  return placementId === identity.viewDefinitionOccurrenceId
    ? {
        nodeId: identity.viewDefinitionNodeId,
        parentNodeId: identity.attachmentNodeId,
        anchor: {
          after: identity.relationDefinitionOccurrenceId,
          before: null,
          affinity: "after",
          fallback: "end",
        },
        derived: true,
      }
    : null;
}

export function viewColumnStates(active: readonly FactAction[], viewId: FactActionId): readonly ViewColumnState[] {
  return causalCollectionStates(active, "view-column")
    .filter((state) => state.addition.action.viewId === viewId)
    .map((state) => {
      const { addition, removed } = state;
      const candidates = factActionsOfKind(state.registers.get("position")?.candidates ?? [], "view-column-move");
      const positions =
        candidates.length === 0 ? [addition.action.anchor] : candidates.map((candidate) => candidate.action.anchor);
      return {
        addition,
        removed,
        anchor: positions[0] ?? addition.action.anchor,
        positionConflicted: state.registers.get("position")?.conflicted ?? false,
        columnNodeId: viewColumnNodeId(addition.id),
      };
    });
}

export function viewSortStates(active: readonly FactAction[], viewId: FactActionId): readonly ViewSortState[] {
  return causalCollectionStates(active, "view-sort")
    .filter((state) => state.addition.action.viewId === viewId)
    .map((state) => {
      const { addition, removed } = state;
      const candidates = factActionsOfKind(
        state.registers.get("configuration")?.candidates ?? [],
        "view-sort-configure",
      );
      const values =
        candidates.length === 0
          ? [{ fieldDefinitionId: addition.action.fieldDefinitionId, direction: addition.action.direction }]
          : candidates.map((candidate) => ({
              fieldDefinitionId: candidate.action.fieldDefinitionId,
              direction: candidate.action.direction,
            }));
      const unique = new Map(values.map((value) => [canonicalJson(value), value]));
      const selected = [...unique.values()].sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      )[0] ?? {
        fieldDefinitionId: addition.action.fieldDefinitionId,
        direction: addition.action.direction,
      };
      return {
        addition,
        removed,
        ...selected,
        configurationCandidates: candidates,
        configurationConflicted: state.registers.get("configuration")?.conflicted ?? false,
        sortNodeId: viewSortNodeId(addition.id),
      };
    });
}

export function viewGroupStates(active: readonly FactAction[], viewId: FactActionId): readonly ViewGroupState[] {
  return causalCollectionStates(active, "view-group")
    .filter((state) => state.addition.action.viewId === viewId)
    .map(({ addition, removed }) => ({ addition, removed, groupNodeId: viewGroupNodeId(addition.id) }));
}

export function viewFilterStates(active: readonly FactAction[], viewId: FactActionId): readonly ViewFilterState[] {
  return causalCollectionStates(active, "view-filter")
    .filter((state) => state.addition.action.viewId === viewId)
    .map(({ addition, removed }) => ({ addition, removed, filterNodeId: viewFilterNodeId(addition.id) }));
}

function after(occurrenceId: string): SequenceAnchor {
  return { after: occurrenceId, before: null, affinity: "after", fallback: "end" };
}
