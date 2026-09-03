import type {
  OutlineCompletionContext,
  OutlineCompletionMatch,
  OutlineCompletionProvider,
  OutlineRow,
} from "../components/outline-tree.js";
import { contentToPlainText } from "../components/outline-content.js";
import { fieldValueSuggestionIds, outlineCommands, type DemoGraph, type NodeValue } from "./outline-demo-model.js";
import { searchNodes } from "./outline-demo-graph.js";

export const completionIds = {
  command: "command",
  field: "field",
  reference: "reference",
  value: "value",
} as const;

type CompletionOptions = Readonly<{
  fieldValueKeys: ReadonlySet<string>;
  graph: DemoGraph;
  rows: readonly OutlineRow<NodeValue>[];
}>;

function matched(
  context: OutlineCompletionContext,
  expression: RegExp,
  triggerLength: (match: RegExpExecArray) => number,
): OutlineCompletionMatch | null {
  if (context.selection.from !== context.selection.to) {
    return null;
  }
  const match = expression.exec(context.textBeforeCaret);
  const query = match?.at(-1);
  if (match === null || query === undefined) {
    return null;
  }
  return {
    from: context.selection.from - query.length - triggerLength(match),
    query,
    to: context.selection.from,
  };
}

export function createDemoCompletionProviders({
  fieldValueKeys,
  graph,
  rows,
}: CompletionOptions): readonly OutlineCompletionProvider<NodeValue>[] {
  return [
    {
      ariaLabel: "Fields",
      emptyLabel: "No matching fields",
      exitOnSelect: true,
      heading: "Use a field definition",
      id: completionIds.field,
      items: (_row, query) => {
        const normalized = query.toLocaleLowerCase();
        return Object.values(graph.nodes).flatMap((node) => {
          const label = contentToPlainText(node.value.content);
          return node.value.field?.kind === "definition" && label.toLocaleLowerCase().includes(normalized)
            ? [{ id: node.id, label, replacement: node.value.content }]
            : [];
        });
      },
      match: (context) => matched(context, /^>([^>\n]*)$/u, () => 1),
    },
    {
      ariaLabel: "References",
      emptyLabel: "No matching nodes",
      heading: "Link a node",
      id: completionIds.reference,
      items: (_row, query) =>
        searchNodes(graph, query).map((node) => ({
          ...node,
          replacement: [{ id: node.id, label: node.label, type: "reference" as const }],
        })),
      match: (context) => matched(context, /(\[\[|@)([^\u005B\u005D@\n]*)$/u, (match) => match[1]?.length ?? 0),
    },
    {
      ariaLabel: "Commands",
      emptyLabel: "No matching commands",
      heading: "Insert or transform",
      id: completionIds.command,
      items: (_row, query) => {
        const normalized = query.toLocaleLowerCase();
        return outlineCommands
          .filter((command) =>
            [command.label, command.description ?? "", ...(command.keywords ?? [])]
              .join(" ")
              .toLocaleLowerCase()
              .includes(normalized),
          )
          .map((command) => ({ ...command, replacement: [] }));
      },
      match: (context) => matched(context, /(?:^|\s)\/([^\s/]*)$/u, () => 1),
    },
    {
      ariaLabel: "Suggested values",
      emptyLabel: "No matching suggested values",
      enabled: (row) => fieldValueKeys.has(row.key),
      heading: "Suggested values",
      id: completionIds.value,
      items: (row, query) => {
        const parent = row.parentKey === null ? undefined : rows.find((candidate) => candidate.key === row.parentKey);
        const field = parent?.occurrence.value.field;
        const definition = field?.kind === "field" ? graph.nodes[field.definitionId] : undefined;
        const datatype = definition?.value.field?.kind === "definition" ? definition.value.field.datatype : undefined;
        const suggestions =
          datatype === "options" || datatype === "options-from-supertag" ? fieldValueSuggestionIds[datatype] : [];
        const normalized = query.toLocaleLowerCase();
        return suggestions.flatMap((nodeId) => {
          const node = graph.nodes[nodeId];
          const label = node === undefined ? "" : contentToPlainText(node.value.content);
          return node !== undefined && label.toLocaleLowerCase().includes(normalized)
            ? [{ id: node.id, label, replacement: node.value.content }]
            : [];
        });
      },
      match: (context) =>
        context.selection.from === context.selection.to
          ? { from: 0, query: context.text, to: context.text.length }
          : null,
      openOnEmptyFocus: true,
    },
  ];
}
