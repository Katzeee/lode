import type {
  OutlineCompletionContext,
  OutlineCompletionMatch,
  OutlineCompletionProvider,
} from "../components/outline/outline-tree.js";
import { inlineSource } from "../components/outline/outline-content.js";
import { demoInlineToken, demoNodeLabel } from "./outline-demo-inline.js";
import type { DemoOutlineCommand } from "./outline-demo-commands.js";
import { fieldValueSuggestionIds, type DemoGraph } from "./outline-demo-model.js";
import { searchNodes } from "./outline-demo-graph.js";

export const completionIds = {
  command: "command",
  field: "field",
  reference: "reference",
  supertag: "supertag",
  value: "value",
} as const;

type CompletionOptions = Readonly<{
  commands: readonly DemoOutlineCommand[];
  fieldDefinitionIdsByKey: ReadonlyMap<string, string>;
  graph: DemoGraph;
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

function matchToken(context: OutlineCompletionContext, trigger: "@" | "#"): OutlineCompletionMatch | null {
  if (context.selection.from !== context.selection.to) {
    return null;
  }
  const caret = context.selection.from;
  let sourceFrom = 0;
  let sourceTo = context.text.length;
  let offset = 0;
  for (const inline of context.content) {
    const end = offset + inlineSource(inline).length;
    if (inline.type === "token") {
      if (caret > offset && caret <= end) {
        return null;
      }
      if (end <= caret) {
        sourceFrom = end;
      } else {
        sourceTo = offset;
        break;
      }
    }
    offset = end;
  }
  // A search belongs to one unresolved expression. Completed tokens and closing braces end its range.
  const source = context.text.slice(sourceFrom, sourceTo);
  const expressions = /(?:^|[\s(])([@#])(?:\{((?:\\.|[^}\\\n])*)(\})?|([^\s@#{}]*))/gu;
  for (const expression of source.matchAll(expressions)) {
    const symbol = expression[1];
    if (symbol !== "@" && symbol !== "#") {
      continue;
    }
    const from = sourceFrom + expression.index + expression[0].indexOf(symbol);
    const to = sourceFrom + expression.index + expression[0].length;
    const bracedQuery = expression[2];
    if (caret <= from || caret > to || (expression[3] !== undefined && caret === to)) {
      continue;
    }
    return symbol !== trigger
      ? null
      : {
          from,
          query:
            bracedQuery === undefined ? context.text.slice(from + 1, caret) : bracedQuery.replace(/\\([\\}])/gu, "$1"),
          to: bracedQuery === undefined ? caret : to,
        };
  }
  return null;
}

export function createDemoCompletionProviders({
  commands,
  fieldDefinitionIdsByKey,
  graph,
}: CompletionOptions): readonly OutlineCompletionProvider[] {
  return [
    {
      ariaLabel: "Fields",
      emptyLabel: "No matching fields",
      exitOnSelect: true,
      heading: "Use a field definition",
      id: completionIds.field,
      items: (_key, query) => {
        const normalized = query.toLocaleLowerCase();
        return Object.values(graph.nodes).flatMap((node) => {
          const label = demoNodeLabel(node.value.content);
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
      items: (_key, query) =>
        searchNodes(graph, query).map((node) => ({
          ...node,
          replacement: [demoInlineToken("reference", node.id, node.label)],
        })),
      match: (context) => matchToken(context, "@"),
    },
    {
      ariaLabel: "Supertags",
      emptyLabel: "No matching Supertags",
      heading: "Apply a Supertag",
      id: completionIds.supertag,
      items: (_key, query) =>
        Object.values(graph.nodes).flatMap((node) => {
          const label = demoNodeLabel(node.value.content);
          return node.value.supertag === true && label.toLocaleLowerCase().includes(query.toLocaleLowerCase())
            ? [{ id: node.id, label, replacement: [demoInlineToken("supertag", node.id, label)] }]
            : [];
        }),
      match: (context) => matchToken(context, "#"),
    },
    {
      ariaLabel: "Commands",
      emptyLabel: "No matching commands",
      heading: "Insert or transform",
      id: completionIds.command,
      items: (_key, query) => {
        const normalized = query.toLocaleLowerCase();
        return commands.filter((command) =>
          [command.label, command.description ?? "", ...(command.keywords ?? [])]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalized),
        );
      },
      match: (context) => matched(context, /(?:^|\s)\/([^\s/]*)$/u, () => 1),
    },
    {
      ariaLabel: "Suggested values",
      emptyLabel: "No matching suggested values",
      enabled: (key) => fieldDefinitionIdsByKey.has(key),
      heading: "Suggested values",
      id: completionIds.value,
      items: (key, query) => {
        const fieldDefinitionId = fieldDefinitionIdsByKey.get(key);
        const definition = fieldDefinitionId === undefined ? undefined : graph.nodes[fieldDefinitionId];
        const datatype = definition?.value.field?.kind === "definition" ? definition.value.field.datatype : undefined;
        const suggestions =
          datatype === "options" || datatype === "options-from-supertag" ? fieldValueSuggestionIds[datatype] : [];
        const normalized = query.toLocaleLowerCase();
        return suggestions.flatMap((nodeId) => {
          const node = graph.nodes[nodeId];
          const label = node === undefined ? "" : demoNodeLabel(node.value.content);
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
