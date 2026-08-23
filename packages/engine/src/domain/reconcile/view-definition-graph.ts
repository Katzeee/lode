import {
  canonicalJson,
  causalMaxima,
  factObserves,
  type FactAction,
  type FactActionId,
  type FactActionOf,
  type SequenceAnchor,
  type ViewSortDirection,
  type ViewType,
  NODE_VIEWS_DEFINITION_NODE_ID,
} from "../fact/index.js";
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
  const additions = actionsOf(active, "shared-default-view-add");
  const removals = actionsOf(active, "shared-default-view-remove");
  const restores = actionsOf(active, "shared-default-view-restore");
  const modes = actionsOf(active, "view-mode-set");
  return additions.map((addition) => {
    const supports: readonly FactAction[] = [
      addition,
      ...restores.filter((restore) => restore.action.viewId === addition.id),
    ];
    const removed = supports.every((support) =>
      removals.some(
        (removal) => removal.action.hostNodeId === addition.action.hostNodeId && observes(removal, support),
      ),
    );
    const candidates = causalMaxima(
      modes.filter((mode) => mode.action.viewId === addition.id),
      () => true,
    );
    const values =
      candidates.length === 0 ? [addition.action.viewType] : candidates.map((candidate) => candidate.action.viewType);
    const unique = [...new Set(values)].sort();
    return {
      addition,
      removed,
      viewType: unique[0] ?? addition.action.viewType,
      modeCandidates: candidates,
      modeConflicted: unique.length > 1,
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
  const additions = actionsOf(active, "view-column-add").filter((action) => action.action.viewId === viewId);
  const removals = actionsOf(active, "view-column-remove").filter((action) => action.action.viewId === viewId);
  const moves = actionsOf(active, "view-column-move");
  return additions.map((addition) => {
    const removed = removals.some(
      (removal) =>
        removal.action.fieldDefinitionId === addition.action.fieldDefinitionId && observes(removal, addition),
    );
    const candidates = causalMaxima(
      moves.filter((move) => move.action.columnId === addition.id),
      () => true,
    );
    const positions =
      candidates.length === 0 ? [addition.action.anchor] : candidates.map((candidate) => candidate.action.anchor);
    const unique = new Map(positions.map((anchor) => [canonicalJson(anchor), anchor]));
    return {
      addition,
      removed,
      anchor: [...unique.values()][0] ?? addition.action.anchor,
      positionConflicted: unique.size > 1,
      columnNodeId: viewColumnNodeId(addition.id),
    };
  });
}

export function viewSortStates(active: readonly FactAction[], viewId: FactActionId): readonly ViewSortState[] {
  const additions = actionsOf(active, "view-sort-add").filter((action) => action.action.viewId === viewId);
  const removals = actionsOf(active, "view-sort-remove").filter((action) => action.action.viewId === viewId);
  const restores = actionsOf(active, "view-sort-restore");
  const configurations = actionsOf(active, "view-sort-configure");
  return additions.map((addition) => {
    const supports: readonly FactAction[] = [
      addition,
      ...restores.filter((restore) => restore.action.sortId === addition.id),
    ];
    const removed = supports.every((support) => removals.some((removal) => observes(removal, support)));
    const candidates = causalMaxima(
      configurations.filter((value) => value.action.sortId === addition.id),
      () => true,
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
      configurationConflicted: unique.size > 1,
      sortNodeId: viewSortNodeId(addition.id),
    };
  });
}

export function viewGroupStates(active: readonly FactAction[], viewId: FactActionId): readonly ViewGroupState[] {
  const additions = actionsOf(active, "view-group-add").filter((action) => action.action.viewId === viewId);
  const removals = actionsOf(active, "view-group-remove").filter((action) => action.action.viewId === viewId);
  return additions.map((addition) => ({
    addition,
    removed: removals.some((removal) => observes(removal, addition)),
    groupNodeId: viewGroupNodeId(addition.id),
  }));
}

export function viewFilterStates(active: readonly FactAction[], viewId: FactActionId): readonly ViewFilterState[] {
  const additions = actionsOf(active, "view-filter-add").filter((action) => action.action.viewId === viewId);
  const removals = actionsOf(active, "view-filter-remove").filter((action) => action.action.viewId === viewId);
  const restores = actionsOf(active, "view-filter-restore");
  return additions.map((addition) => {
    const supports: readonly FactAction[] = [
      addition,
      ...restores.filter((restore) => restore.action.filterId === addition.id),
    ];
    return {
      addition,
      removed: supports.every((support) => removals.some((removal) => observes(removal, support))),
      filterNodeId: viewFilterNodeId(addition.id),
    };
  });
}

function actionsOf<Kind extends FactAction["action"]["kind"]>(
  active: readonly FactAction[],
  kind: Kind,
): readonly (FactAction & Readonly<{ action: Extract<FactAction["action"], { kind: Kind }> }>)[] {
  return active.filter(
    (fact): fact is FactAction & Readonly<{ action: Extract<FactAction["action"], { kind: Kind }> }> =>
      fact.action.kind === kind,
  );
}

function observes(observer: FactAction, observed: FactAction): boolean {
  return observer.factId === observed.factId ? observer.index > observed.index : factObserves(observer, observed);
}

const start = { after: null, before: null, affinity: "before", fallback: "start" } as const;

function after(occurrenceId: string): SequenceAnchor {
  return { after: occurrenceId, before: null, affinity: "after", fallback: "end" };
}
