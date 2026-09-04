import { contentToPlainText } from "../components/outline-content.js";
import type {
  OutlineBulletMarker,
  OutlineFieldBulletDatatype,
  OutlineItemViewModel,
} from "../components/outline-tree.js";
import { resolveGraphPath } from "./outline-demo-graph.js";
import type { DemoGraph, DemoNode, DemoOccurrence, FieldDatatype, NodeValue } from "./outline-demo-model.js";

export type DemoOutlineProjection = Readonly<{
  fieldDefinitionIdsByKey: ReadonlyMap<string, string>;
  items: readonly OutlineItemViewModel[];
  modelPathsByKey: ReadonlyMap<string, string>;
}>;

export function projectOutline(graph: DemoGraph, parentKey: string | null = null): DemoOutlineProjection {
  const parent = parentKey === null ? null : resolveGraphPath(graph, parentKey);
  const ids = parentKey === null ? graph.rootOccurrenceIds : (parent?.node.childOccurrenceIds ?? []);
  const modelPathsByKey = new Map<string, string>();
  const fieldDefinitionIdsByKey = new Map<string, string>();
  const items = projectOccurrenceIds(
    graph,
    ids,
    parentKey,
    parent?.node,
    parent === null ? new Set() : new Set([parent.node.id]),
    modelPathsByKey,
    fieldDefinitionIdsByKey,
  );
  return { fieldDefinitionIdsByKey, items, modelPathsByKey };
}

function projectOccurrenceIds(
  graph: DemoGraph,
  ids: readonly string[],
  parentPath: string | null,
  parentNode: DemoNode | undefined,
  ancestorNodeIds: ReadonlySet<string>,
  modelPathsByKey: Map<string, string>,
  fieldDefinitionIdsByKey: Map<string, string>,
): readonly OutlineItemViewModel[] {
  return ids.flatMap((occurrenceId) => {
    const occurrence = graph.occurrences[occurrenceId];
    const node = occurrence === undefined ? undefined : graph.nodes[occurrence.nodeId];
    if (occurrence === undefined || node === undefined) {
      return [];
    }
    const modelPath = parentPath === null ? occurrence.id : `${parentPath}/${occurrence.id}`;
    const key = `outline-item:${encodeURIComponent(modelPath)}`;
    const fieldDefinitionId =
      parentNode?.value.field?.kind === "field" ? parentNode.value.field.definitionId : undefined;
    modelPathsByKey.set(key, modelPath);
    if (fieldDefinitionId !== undefined) {
      fieldDefinitionIdsByKey.set(key, fieldDefinitionId);
    }
    const cyclic = ancestorNodeIds.has(node.id);
    const nextAncestors = new Set(ancestorNodeIds).add(node.id);
    return [
      {
        accessibilityLabel: contentToPlainText(node.value.content) || "Untitled item",
        badges: node.value.tags?.map((label) => ({ label, tone: "accent" })),
        bullet: projectBullet(graph, node.value, occurrence, fieldDefinitionId !== undefined),
        checkbox:
          node.value.todo === undefined
            ? undefined
            : { checked: node.value.todo === "done", label: `Toggle ${contentToPlainText(node.value.content)}` },
        children:
          cyclic || node.childOccurrenceIds.length === 0
            ? undefined
            : projectOccurrenceIds(
                graph,
                node.childOccurrenceIds,
                modelPath,
                node,
                nextAncestors,
                modelPathsByKey,
                fieldDefinitionIdsByKey,
              ),
        childrenLayout: node.value.field?.kind === "field" ? "beside" : undefined,
        content: node.value.content,
        editable: node.value.editable !== false,
        expandable: cyclic ? false : occurrence.expandable,
        key,
        progress: node.value.progress,
        textStyle: {
          decoration: node.value.todo === "done" ? "line-through" : undefined,
          tone: node.value.todo === "done" || node.value.field?.kind === "field" ? "muted" : "default",
          weight: node.value.field?.kind === "field" ? "medium" : "normal",
        },
      },
    ];
  });
}

function fieldBulletDatatype(datatype: FieldDatatype): OutlineFieldBulletDatatype {
  return datatype === "plain" ? "text" : datatype === "options-from-supertag" ? "supertag" : datatype;
}

function fieldDatatype(graph: DemoGraph, value: NodeValue): FieldDatatype | undefined {
  if (value.field?.kind === "definition") {
    return value.field.datatype;
  }
  const definition = value.field?.kind === "field" ? graph.nodes[value.field.definitionId] : undefined;
  return definition?.value.field?.kind === "definition" ? definition.value.field.datatype : undefined;
}

function projectBullet(
  graph: DemoGraph,
  value: NodeValue,
  occurrence: DemoOccurrence,
  fieldValue: boolean,
): OutlineItemViewModel["bullet"] {
  let marker: OutlineBulletMarker | undefined;
  if (value.field !== undefined) {
    marker = {
      datatype: fieldBulletDatatype(fieldDatatype(graph, value) ?? "plain"),
      prominence: value.field.kind === "definition" ? "strong" : "default",
      type: "field",
    };
  } else if (!fieldValue && value.bullet !== undefined) {
    marker = { type: value.bullet };
  }
  return {
    appearance: occurrence.appearance === "reference" ? "reference" : "node",
    marker,
    tone: value.tags === undefined ? "default" : "accent",
  };
}
