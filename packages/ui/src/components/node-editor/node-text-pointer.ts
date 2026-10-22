import { caretOffsetAtPoint } from "./outline-caret.js";
import { contentLength, contentToSource, type OutlineContent } from "./outline-content.js";

export function nodeTextPointerSelection(
  root: Element,
  content: OutlineContent,
  point: Readonly<{ clientX: number; clientY: number; detail: number }>,
) {
  const element = root.querySelector<HTMLElement>('[data-ui="outline-editor"], [data-ui="outline-inline-content"]');
  const offset = element === null ? contentLength(content) : caretOffsetAtPoint(element, point.clientX, point.clientY);
  if (point.detail < 2) {
    return { from: offset, to: offset };
  }
  const source = contentToSource(content);
  const word = [...source.matchAll(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]+/gu)].find(
    (match) => offset >= match.index && offset < match.index + match[0].length,
  );
  const from = point.detail === 2 ? (word?.index ?? offset) : 0;
  return { from, to: point.detail === 2 ? from + (word?.[0].length ?? 0) : source.length };
}
