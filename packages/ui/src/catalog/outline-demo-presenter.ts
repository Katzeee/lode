import { demoNodeLabel } from "./outline-demo-inline.js";
import type { OutlineItemViewModel } from "../components/outline/outline-tree.js";
import type { DemoFieldGlyph, DemoOutlinePresentation } from "./outline-demo-presentation.js";
import { resolveGraphPath } from "./outline-demo-graph.js";
import type { DemoGraph, DemoNode, DemoOccurrence, FieldDatatype, NodeValue } from "./outline-demo-model.js";

export type DemoPresentedOutline = Readonly<{
  fieldDefinitionIdsByKey: ReadonlyMap<string, string>;
  items: readonly OutlineItemViewModel<DemoOutlinePresentation>[];
  modelPathsByKey: ReadonlyMap<string, string>;
}>;

export function presentOutline(graph: DemoGraph, parentKey: string | null = null): DemoPresentedOutline {
  const parent = parentKey === null ? null : resolveGraphPath(graph, parentKey);
  const ids = parentKey === null ? graph.rootOccurrenceIds : (parent?.node.childOccurrenceIds ?? []);
  const modelPathsByKey = new Map<string, string>();
  const fieldDefinitionIdsByKey = new Map<string, string>();
  const items = presentOccurrenceIds(
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

function presentOccurrenceIds(
  graph: DemoGraph,
  ids: readonly string[],
  parentPath: string | null,
  parentNode: DemoNode | undefined,
  ancestorNodeIds: ReadonlySet<string>,
  modelPathsByKey: Map<string, string>,
  fieldDefinitionIdsByKey: Map<string, string>,
): readonly OutlineItemViewModel<DemoOutlinePresentation>[] {
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
        accessibilityLabel: demoNodeLabel(node.value.content) || "Untitled item",
        children:
          cyclic || node.childOccurrenceIds.length === 0
            ? undefined
            : presentOccurrenceIds(
                graph,
                node.childOccurrenceIds,
                modelPath,
                node,
                nextAncestors,
                modelPathsByKey,
                fieldDefinitionIdsByKey,
              ),
        content: node.value.content,
        editable: node.value.editable !== false,
        readonlyReason: node.value.editable === false ? readonlyReason(node.value) : undefined,
        expandable: cyclic ? false : occurrence.expandable,
        key,
        presentation: presentNode(graph, node.value, occurrence, fieldDefinitionId !== undefined),
      },
    ];
  });
}

function fieldGlyph(datatype: FieldDatatype): DemoFieldGlyph {
  return datatype === "plain" ? "text" : datatype === "options-from-supertag" ? "supertag" : datatype;
}

function readonlyReason(value: NodeValue): string {
  if (value.field !== undefined) {
    return value.field.kind === "field"
      ? "Name comes from the field definition."
      : "This name is managed in field configuration.";
  }
  return value.intrinsicNodeType === "calendar"
    ? "This name is managed by the calendar."
    : "This name is managed by the system.";
}

function fieldDatatype(graph: DemoGraph, value: NodeValue): FieldDatatype | undefined {
  if (value.field?.kind === "definition") {
    return value.field.datatype;
  }
  const definition = value.field?.kind === "field" ? graph.nodes[value.field.definitionId] : undefined;
  return definition?.value.field?.kind === "definition" ? definition.value.field.datatype : undefined;
}

function presentNode(
  graph: DemoGraph,
  value: NodeValue,
  occurrence: DemoOccurrence,
  fieldValue: boolean,
): DemoOutlinePresentation {
  const base = {
    appearance: occurrence.appearance === "reference" ? ("reference" as const) : ("node" as const),
    checkbox:
      value.todo === undefined
        ? undefined
        : { checked: value.todo === "done", label: `Toggle ${demoNodeLabel(value.content)}` },
    childrenLayout: value.field?.kind === "field" ? ("beside" as const) : undefined,
    contentStyle: {
      decoration: value.todo === "done" ? ("line-through" as const) : undefined,
      tone: value.todo === "done" || value.field?.kind === "field" ? ("muted" as const) : ("default" as const),
      weight: value.field?.kind === "field" ? ("medium" as const) : ("normal" as const),
    },
    progress: value.progress,
  };
  if (value.field !== undefined) {
    return {
      ...base,
      datatype: fieldGlyph(fieldDatatype(graph, value) ?? "plain"),
      kind: "field",
      prominence: value.field.kind === "definition" ? "strong" : "default",
    };
  }
  const kind = fieldValue ? "plain" : (value.intrinsicNodeType ?? "plain");
  return { ...base, kind };
}
