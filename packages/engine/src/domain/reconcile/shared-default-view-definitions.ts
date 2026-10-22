import {
  compareCausalOrder,
  stableStringCompare,
  type FactAction,
  type FactActionId,
  type ViewColumnSpec,
  type ViewOptionsSpec,
  type ViewSortSpec,
} from "../fact/index.js";
import { insertAtAnchor } from "./sequence.js";
import { nodeLocation } from "./node-graph.js";
import { projectSearchExpressionForHost } from "./search-expressions.js";
import { searchExpressionStates } from "./search-expression-graph.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import type { SharedDefaultViewDefinition } from "./projection-types.js";
import {
  viewColumnStates,
  viewFilterStates,
  viewGroupStates,
  viewSortStates,
  viewStates,
} from "./view-definition-graph.js";
import type { WorkspaceSystemNodes } from "./workspace-system-nodes.js";

export function projectSharedDefaultViewDefinitions(
  workspaceNodeId: string,
  active: readonly FactAction[],
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  _metanodes: Readonly<Record<string, string>>,
  workspaceSystemNodes: WorkspaceSystemNodes,
  _materializedFields: unknown,
): Readonly<Record<string, readonly SharedDefaultViewDefinition[]>> {
  const context = {
    workspaceNodeId,
    active,
    nodes,
    occurrences,
    childOccurrences,
    nodeOwners,
    workspaceSystemNodes,
    graph: { nodes: Object.fromEntries(nodes), nodeOwners, workspaceSystemNodes },
    expressions: searchExpressionStates(active),
  };
  const definitions = viewStates(active)
    .filter((view) => !view.removed)
    .flatMap((view) => projectViewDefinition(view, context));
  const byHost = new Map<string, SharedDefaultViewDefinition[]>();
  for (const definition of definitions) {
    const values = byHost.get(definition.hostNodeId) ?? [];
    values.push(definition);
    byHost.set(definition.hostNodeId, values);
  }
  return Object.fromEntries(
    [...byHost]
      .sort(([left], [right]) => stableStringCompare(left, right))
      .map(([host, values]) => [host, values.sort((left, right) => stableStringCompare(left.viewId, right.viewId))]),
  );
}
type ViewProjectionContext = Readonly<{
  workspaceNodeId: string;
  active: readonly FactAction[];
  nodes: ReadonlyMap<string, MutableNode>;
  occurrences: ReadonlyMap<string, MutableOccurrence>;
  childOccurrences: ReadonlyMap<string, readonly string[]>;
  nodeOwners: Readonly<Record<string, string | null>>;
  workspaceSystemNodes: WorkspaceSystemNodes;
  graph: Readonly<{
    nodes: Readonly<Record<string, MutableNode>>;
    nodeOwners: Readonly<Record<string, string | null>>;
    workspaceSystemNodes: WorkspaceSystemNodes;
  }>;
  expressions: ReturnType<typeof searchExpressionStates>;
}>;

function projectViewDefinition(
  view: ReturnType<typeof viewStates>[number],
  context: ViewProjectionContext,
): readonly SharedDefaultViewDefinition[] {
  const { identity } = view;
  const attachment = context.occurrences.get(identity.attachmentOccurrenceId);
  const definition = context.occurrences.get(identity.viewDefinitionOccurrenceId);
  if (
    nodeLocation(context.workspaceNodeId, context.graph, view.addition.action.hostNodeId) !== "active" ||
    attachment?.nodeId !== identity.attachmentNodeId ||
    definition?.nodeId !== identity.viewDefinitionNodeId ||
    context.nodeOwners[identity.viewDefinitionNodeId] !== identity.attachmentNodeId
  ) {
    return [];
  }
  const columns = viewColumnStates(context.active, view.addition.id).filter((column) => !column.removed);
  const projectedColumns = projectColumns(columns);
  const sorts = viewSortStates(context.active, view.addition.id).filter((sort) => !sort.removed);
  const selectedSort = [...sorts].sort((left, right) => compareCausalOrder(left.addition, right.addition))[0];
  const sort: ViewSortSpec | null = selectedSort
    ? {
        sortId: selectedSort.addition.id,
        sortNodeId: selectedSort.sortNodeId,
        fieldDefinitionId: selectedSort.fieldDefinitionId,
        direction: selectedSort.direction,
      }
    : null;
  const groups = viewGroupStates(context.active, view.addition.id).filter((group) => !group.removed);
  const selectedGroup = [...groups].sort((left, right) => compareCausalOrder(left.addition, right.addition))[0];
  const group = selectedGroup
    ? {
        groupId: selectedGroup.addition.id,
        groupNodeId: selectedGroup.groupNodeId,
        fieldDefinitionId: selectedGroup.addition.action.fieldDefinitionId,
      }
    : null;
  const filters = viewFilterStates(context.active, view.addition.id).filter((filter) => !filter.removed);
  const selectedFilter = [...filters].sort((left, right) => compareCausalOrder(left.addition, right.addition))[0];
  const filterExpression = selectedFilter
    ? projectSearchExpressionForHost(
        selectedFilter.addition.id,
        context.expressions,
        context.childOccurrences,
        context.workspaceNodeId,
        context.graph,
        context.nodes,
      )
    : null;
  const filter =
    selectedFilter && filterExpression
      ? {
          filterId: selectedFilter.addition.id,
          filterNodeId: selectedFilter.filterNodeId,
          expression: filterExpression.expression,
        }
      : null;
  const options: ViewOptionsSpec = { columns: projectedColumns, filter, sort, group };
  const optionActions = [
    ...columns.map((column) => column.addition.id),
    ...sorts.flatMap((candidate) => [candidate.addition.id, ...candidate.configurationCandidates.map(({ id }) => id)]),
    ...groups.map((candidate) => candidate.addition.id),
    ...filters.map((candidate) => candidate.addition.id),
  ].sort(stableStringCompare);
  const optionsConflicted =
    columns.some((column) => column.positionConflicted) ||
    sorts.length > 1 ||
    sorts.some((candidate) => candidate.configurationConflicted) ||
    groups.length > 1 ||
    filters.length > 1 ||
    (selectedFilter !== undefined && filterExpression === null);
  return [
    {
      viewId: view.addition.id,
      hostNodeId: view.addition.action.hostNodeId,
      attachmentNodeId: identity.attachmentNodeId,
      attachmentOccurrenceId: identity.attachmentOccurrenceId,
      relationDefinitionOccurrenceId: identity.relationDefinitionOccurrenceId,
      viewDefinitionNodeId: identity.viewDefinitionNodeId,
      viewDefinitionOccurrenceId: identity.viewDefinitionOccurrenceId,
      viewType: view.viewType,
      modeActionIds: [view.addition.id, ...view.modeCandidates.map(({ id }) => id)],
      options,
      optionsActionIds: optionActions,
      optionsConflicted: optionsConflicted || view.modeConflicted,
    },
  ];
}
function projectColumns(columns: ReturnType<typeof viewColumnStates>): readonly ViewColumnSpec[] {
  const orderedColumnIds: FactActionId[] = [];
  for (const column of [...columns].sort((left, right) => compareCausalOrder(left.addition, right.addition))) {
    insertAtAnchor(orderedColumnIds, column.addition.id, column.anchor);
  }
  const byColumnId = new Map(columns.map((column) => [column.addition.id, column]));
  return orderedColumnIds.flatMap((columnId) => {
    const column = byColumnId.get(columnId);
    return !column || column.positionConflicted
      ? []
      : [
          {
            columnId: column.addition.id,
            columnNodeId: column.columnNodeId,
            fieldDefinitionId: column.addition.action.fieldDefinitionId,
          },
        ];
  });
}
