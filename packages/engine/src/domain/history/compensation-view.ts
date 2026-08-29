import { isViewAction, type FactAction, type FactActionId, type ViewAction } from "../fact/index.js";
import { sequenceAnchorAt, type InterpretedProjection } from "../reconcile/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateViewAction(
  target: FactAction,
  _activeFacts: readonly FactAction[],
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep | null {
  const action = target.action;
  if (!isViewAction(action)) {
    return null;
  }
  if (action.kind === "shared-default-view-add") {
    return { kind: "ready", actions: [{ kind: "shared-default-view-remove", hostNodeId: action.hostNodeId }] };
  }
  if (action.kind === "shared-default-view-remove") {
    const views = counterfactual.sharedDefaultViewDefinitions[action.hostNodeId] ?? [];
    return views.length === 0
      ? noCompensation()
      : { kind: "ready", actions: views.map((view) => ({ kind: "shared-default-view-restore", viewId: view.viewId })) };
  }
  const targetProjection =
    action.kind === "view-sort-restore" || action.kind === "view-filter-restore" ? projection : counterfactual;
  const viewId = targetViewId(action, targetProjection);
  if (!viewId) {
    return noCompensation();
  }
  if (action.kind === "shared-default-view-restore") {
    const restored = findView(projection, viewId);
    return restored
      ? { kind: "ready", actions: [{ kind: "shared-default-view-remove", hostNodeId: restored.hostNodeId }] }
      : noCompensation();
  }
  const view = findView(counterfactual, viewId);
  if (action.kind === "view-mode-set") {
    return view
      ? { kind: "ready", actions: [{ kind: action.kind, viewId, viewType: view.viewType }] }
      : noCompensation();
  }
  return compensateViewOption(action, viewId, view);
}

type ViewOptionAction = Exclude<
  ViewAction,
  { kind: "shared-default-view-add" | "shared-default-view-remove" | "shared-default-view-restore" | "view-mode-set" }
>;

function compensateViewOption(
  action: ViewOptionAction,
  viewId: FactActionId,
  view: ReturnType<typeof findView>,
): CompensationStep {
  if (action.kind === "view-column-add") {
    return {
      kind: "ready",
      actions: [{ kind: "view-column-remove", viewId, fieldDefinitionId: action.fieldDefinitionId }],
    };
  }
  if (action.kind === "view-column-remove") {
    const column = view?.options.columns.find((candidate) => candidate.fieldDefinitionId === action.fieldDefinitionId);
    if (!view || !column) {
      return noCompensation();
    }
    const ids = view.options.columns.map((candidate) => candidate.columnId);
    return {
      kind: "ready",
      actions: [
        {
          kind: "view-column-add",
          viewId,
          fieldDefinitionId: action.fieldDefinitionId,
          anchor: sequenceAnchorAt(ids, ids.indexOf(column.columnId)),
        },
      ],
    };
  }
  if (action.kind === "view-column-move") {
    const column = view?.options.columns.find((candidate) => candidate.columnId === action.columnId);
    if (!view || !column) {
      return noCompensation();
    }
    const ids = view.options.columns.map((candidate) => candidate.columnId);
    return {
      kind: "ready",
      actions: [
        { kind: action.kind, columnId: action.columnId, anchor: sequenceAnchorAt(ids, ids.indexOf(column.columnId)) },
      ],
    };
  }
  if (action.kind === "view-sort-add") {
    return { kind: "ready", actions: [{ kind: "view-sort-remove", viewId }] };
  }
  if (action.kind === "view-sort-configure") {
    const sort = view?.options.sort;
    return !sort
      ? noCompensation()
      : {
          kind: "ready",
          actions: [
            {
              kind: action.kind,
              sortId: action.sortId,
              fieldDefinitionId: sort.fieldDefinitionId,
              direction: sort.direction,
            },
          ],
        };
  }
  if (action.kind === "view-sort-remove") {
    return view?.options.sort
      ? { kind: "ready", actions: [{ kind: "view-sort-restore", sortId: view.options.sort.sortId }] }
      : noCompensation();
  }
  if (action.kind === "view-sort-restore") {
    return { kind: "ready", actions: [{ kind: "view-sort-remove", viewId }] };
  }
  if (action.kind === "view-group-add") {
    return { kind: "ready", actions: [{ kind: "view-group-remove", viewId }] };
  }
  if (action.kind === "view-group-remove") {
    return view?.options.group
      ? {
          kind: "ready",
          actions: [{ kind: "view-group-add", viewId, fieldDefinitionId: view.options.group.fieldDefinitionId }],
        }
      : noCompensation();
  }
  if (action.kind === "view-filter-add") {
    return { kind: "ready", actions: [{ kind: "view-filter-remove", viewId }] };
  }
  if (action.kind === "view-filter-remove") {
    return view?.options.filter
      ? { kind: "ready", actions: [{ kind: "view-filter-restore", filterId: view.options.filter.filterId }] }
      : noCompensation();
  }
  return { kind: "ready", actions: [{ kind: "view-filter-remove", viewId }] };
}

function targetViewId(action: ViewAction, projection: InterpretedProjection) {
  if ("viewId" in action) {
    return action.viewId;
  }
  if (action.kind === "view-column-move") {
    return (
      Object.values(projection.sharedDefaultViewDefinitions)
        .flat()
        .find((view) => view.options.columns.some((column) => column.columnId === action.columnId))?.viewId ?? null
    );
  }
  if (action.kind === "view-sort-configure" || action.kind === "view-sort-restore") {
    return (
      Object.values(projection.sharedDefaultViewDefinitions)
        .flat()
        .find((view) => view.options.sort?.sortId === action.sortId)?.viewId ?? null
    );
  }
  return action.kind === "view-filter-restore"
    ? (Object.values(projection.sharedDefaultViewDefinitions)
        .flat()
        .find((view) => view.options.filter?.filterId === action.filterId)?.viewId ?? null)
    : null;
}

function findView(projection: InterpretedProjection, viewId: string) {
  return Object.values(projection.sharedDefaultViewDefinitions)
    .flat()
    .find((view) => view.viewId === viewId);
}
