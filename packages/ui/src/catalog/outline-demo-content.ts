import {
  contentToSource,
  inlineSource,
  normalizeContent,
  sliceContent,
  type OutlineContent,
  type OutlineInline,
} from "../components/outline/outline-content.js";
import { outlineFormatting } from "../components/outline/outline-formatting.js";
import { parseOutlineContent, type OutlineSourceSpan } from "../components/outline/outline-inline-extension.js";
import { demoInlineToken, demoNodeLabel } from "./outline-demo-inline.js";
import type { DemoGraph } from "./outline-demo-model.js";

type SourceRange = Readonly<{ from: number; to: number }>;

function literalRanges(spans: readonly OutlineSourceSpan[]): readonly SourceRange[] {
  return spans.flatMap((span): readonly SourceRange[] =>
    span.children !== undefined
      ? literalRanges(span.children)
      : span.extension !== undefined && span.token === undefined
        ? [{ from: span.from, to: span.to }]
        : [],
  );
}

/** Source is resolved by the Model owner, so typed, pasted and repaired syntax has the same meaning. */
export function resolveDemoContent(graph: DemoGraph, content: OutlineContent): OutlineContent {
  const source = contentToSource(content);
  const literals = literalRanges(parseOutlineContent(content, outlineFormatting));
  let offset = 0;
  const bindings = content.flatMap((inline): readonly SourceRange[] => {
    const from = offset;
    offset += inlineSource(inline).length;
    return inline.type === "token" ? [{ from, to: offset }] : [];
  });
  const result: OutlineInline[] = [];
  let consumed = 0;
  for (const match of source.matchAll(/([@#])\{((?:\\.|[^}\\\n])*)\}/gu)) {
    const from = match.index;
    const to = from + match[0].length;
    if (
      literals.some((range) => from >= range.from && from < range.to) ||
      bindings.some((range) => from < range.to && to > range.from)
    ) {
      continue;
    }
    const kind = match[1] === "#" ? "supertag" : "reference";
    const label = (match[2] ?? "").replace(/\\([\\}])/gu, "$1");
    if (label.length === 0) {
      continue;
    }
    const matches = Object.values(graph.nodes).filter(
      (node) => (kind !== "supertag" || node.value.supertag === true) && demoNodeLabel(node.value.content) === label,
    );
    // A name must identify one target; completion can disambiguate otherwise.
    const target = matches.length === 1 ? matches[0] : undefined;
    if (target === undefined) {
      continue;
    }
    result.push(...sliceContent(content, consumed, from), {
      ...demoInlineToken(kind, target.id, label),
      source: match[0],
    });
    consumed = to;
  }
  return normalizeContent([...result, ...sliceContent(content, consumed, source.length)]);
}
