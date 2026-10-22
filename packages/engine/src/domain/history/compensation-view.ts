import type { FactActionId } from "../fact/index.js";
import { sequenceAnchorAt, type InterpretedProjection } from "../reconcile/index.js";
import { noCompensation, ready, type CompensationCatalog } from "./compensation-types.js";

export const VIEW_COMPENSATIONS = {
  "shared-default-view-add": (_context, { action }) =>
    ready([{ kind: "shared-default-view-remove", hostNodeId: action.hostNodeId }]),
  "shared-default-view-remove": ({ counterfactual }, { action }) =>
    ready(
      (counterfactual.sharedDefaultViewDefinitions[action.hostNodeId] ?? []).map((view) => ({
        kind: "shared-default-view-restore",
        viewId: view.viewId,
      })),
    ),
  "shared-default-view-restore": ({ projection }, { action }) => {
    const restored = findView(projection, action.viewId);
    return restored
      ? ready([{ kind: "shared-default-view-remove", hostNodeId: restored.hostNodeId }])
      : noCompensation();
  },
  "view-mode-set": ({ counterfactual }, { action }) => {
    const view = findView(counterfactual, action.viewId);
    return view ? ready([{ kind: "view-mode-set", viewId: action.viewId, viewType: view.viewType }]) : noCompensation();
  },
  "view-column-add": (_context, { action }) =>
    ready([{ kind: "view-column-remove", viewId: action.viewId, fieldDefinitionId: action.fieldDefinitionId }]),
  "view-column-remove": ({ counterfactual }, { action }) => {
    const view = findView(counterfactual, action.viewId);
    const column = view?.options.columns.find((candidate) => candidate.fieldDefinitionId === action.fieldDefinitionId);
    if (!view || !column) {
      return noCompensation();
    }
    const ids = view.options.columns.map((candidate) => candidate.columnId);
    return ready([
      {
        kind: "view-column-add",
        viewId: action.viewId,
        fieldDefinitionId: action.fieldDefinitionId,
        anchor: sequenceAnchorAt(ids, ids.indexOf(column.columnId)),
      },
    ]);
  },
  "view-column-move": ({ counterfactual }, { action }) => {
    const view = Object.values(counterfactual.sharedDefaultViewDefinitions)
      .flat()
      .find((candidate) => candidate.options.columns.some((column) => column.columnId === action.columnId));
    const column = view?.options.columns.find((candidate) => candidate.columnId === action.columnId);
    if (!view || !column) {
      return noCompensation();
    }
    const ids = view.options.columns.map((candidate) => candidate.columnId);
    return ready([
      {
        kind: "view-column-move",
        columnId: action.columnId,
        anchor: sequenceAnchorAt(ids, ids.indexOf(column.columnId)),
      },
    ]);
  },
  "view-sort-add": (_context, { action }) => ready([{ kind: "view-sort-remove", viewId: action.viewId }]),
  "view-sort-configure": ({ counterfactual }, { action }) => {
    const sort = viewBySort(counterfactual, action.sortId)?.options.sort;
    return sort
      ? ready([
          {
            kind: "view-sort-configure",
            sortId: action.sortId,
            fieldDefinitionId: sort.fieldDefinitionId,
            direction: sort.direction,
          },
        ])
      : noCompensation();
  },
  "view-sort-remove": ({ counterfactual }, { action }) => {
    const sort = findView(counterfactual, action.viewId)?.options.sort;
    return sort ? ready([{ kind: "view-sort-restore", sortId: sort.sortId }]) : noCompensation();
  },
  "view-sort-restore": ({ projection }, { action }) => {
    const view = viewBySort(projection, action.sortId);
    return view ? ready([{ kind: "view-sort-remove", viewId: view.viewId }]) : noCompensation();
  },
  "view-group-add": (_context, { action }) => ready([{ kind: "view-group-remove", viewId: action.viewId }]),
  "view-group-remove": ({ counterfactual }, { action }) => {
    const group = findView(counterfactual, action.viewId)?.options.group;
    return group
      ? ready([{ kind: "view-group-add", viewId: action.viewId, fieldDefinitionId: group.fieldDefinitionId }])
      : noCompensation();
  },
  "view-filter-add": (_context, { action }) => ready([{ kind: "view-filter-remove", viewId: action.viewId }]),
  "view-filter-remove": ({ counterfactual }, { action }) => {
    const filter = findView(counterfactual, action.viewId)?.options.filter;
    return filter ? ready([{ kind: "view-filter-restore", filterId: filter.filterId }]) : noCompensation();
  },
  "view-filter-restore": ({ projection }, { action }) => {
    const view = Object.values(projection.sharedDefaultViewDefinitions)
      .flat()
      .find((candidate) => candidate.options.filter?.filterId === action.filterId);
    return view ? ready([{ kind: "view-filter-remove", viewId: view.viewId }]) : noCompensation();
  },
} satisfies Partial<CompensationCatalog>;

function viewBySort(projection: InterpretedProjection, sortId: FactActionId) {
  return Object.values(projection.sharedDefaultViewDefinitions)
    .flat()
    .find((view) => view.options.sort?.sortId === sortId);
}

function findView(projection: InterpretedProjection, viewId: string) {
  return Object.values(projection.sharedDefaultViewDefinitions)
    .flat()
    .find((view) => view.viewId === viewId);
}
