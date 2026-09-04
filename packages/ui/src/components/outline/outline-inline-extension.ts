import type { ReactNode } from "react";

import {
  contentToSource,
  inlineSource,
  sliceContent,
  type OutlineContent,
  type OutlineToken,
} from "./outline-content.js";

export type OutlineSyntaxMatch = Readonly<{
  contentFrom: number;
  contentTo: number;
  length: number;
  literal?: boolean;
}>;

export type OutlineSourceEdit = Readonly<{
  from: number;
  replacement: OutlineContent;
  selection?: Readonly<{ from: number; to: number }>;
  to: number;
}>;

export type OutlineInlineExtension = Readonly<{
  id: string;
  match?: (source: string) => OutlineSyntaxMatch | null;
  render: (context: Readonly<{ children: ReactNode; source: string; token?: OutlineToken }>) => ReactNode;
  shortcut?: Readonly<{
    key: string;
    apply: (content: OutlineContent, selection: Readonly<{ from: number; to: number }>) => OutlineSourceEdit;
  }>;
}>;

export type OutlineSourceSpan = Readonly<{
  children?: readonly OutlineSourceSpan[];
  extension?: OutlineInlineExtension;
  from: number;
  source: string;
  text: string;
  token?: OutlineToken;
  to: number;
}>;

export function parseOutlineSource(
  source: string,
  extensions: readonly OutlineInlineExtension[],
  offset = 0,
  tokens: readonly Readonly<{ from: number; to: number; token: OutlineToken }>[] = [],
): readonly OutlineSourceSpan[] {
  const spans: OutlineSourceSpan[] = [];
  let position = 0;
  let plainStart = 0;
  const flush = () => {
    if (position > plainStart) {
      const text = source.slice(plainStart, position);
      spans.push({ from: offset + plainStart, source: text, text, to: offset + position });
    }
  };
  while (position < source.length) {
    const token = tokens.find((candidate) => candidate.from === offset + position);
    if (token !== undefined) {
      flush();
      spans.push({
        extension: extensions.find((extension) => extension.id === token.token.extension),
        from: token.from,
        to: token.to,
        token: token.token,
        source: token.token.source,
        text: token.token.label,
      });
      position += token.to - token.from;
      plainStart = position;
      continue;
    }
    const remaining = source.slice(position);
    const candidate = extensions
      .map((extension) => ({ extension, match: extension.match?.(remaining) }))
      .find(
        ({ match }) =>
          match !== null &&
          match !== undefined &&
          match.length > 0 &&
          match.length <= remaining.length &&
          match.contentFrom >= 0 &&
          match.contentTo >= match.contentFrom &&
          match.contentTo <= match.length &&
          (match.literal === true || match.contentTo - match.contentFrom < match.length) &&
          !tokens.some((candidate) =>
            [match.contentFrom, match.contentTo, match.length].some(
              (boundary) =>
                offset + position + boundary > candidate.from && offset + position + boundary < candidate.to,
            ),
          ),
      );
    if (candidate?.match === undefined || candidate.match === null) {
      position += 1;
      continue;
    }
    flush();
    const { extension, match } = candidate;
    const text = remaining.slice(match.contentFrom, match.contentTo);
    const from = offset + position + match.contentFrom;
    spans.push({
      children: match.literal === true ? undefined : parseOutlineSource(text, extensions, from, tokens),
      extension,
      from,
      source: remaining.slice(0, match.length),
      text,
      to: offset + position + match.contentTo,
    });
    position += match.length;
    plainStart = position;
  }
  flush();
  return spans;
}

export function parseOutlineContent(
  content: OutlineContent,
  extensions: readonly OutlineInlineExtension[],
): readonly OutlineSourceSpan[] {
  let offset = 0;
  const tokens = content.flatMap((inline) => {
    const from = offset;
    offset += inlineSource(inline).length;
    return inline.type === "token" && offset > from ? [{ from, to: offset, token: inline }] : [];
  });
  return parseOutlineSource(contentToSource(content), extensions, 0, tokens);
}

/** A reusable operation for extensions that surround a selection with source delimiters. */
export function surroundOutlineSelection(
  content: OutlineContent,
  selection: Readonly<{ from: number; to: number }>,
  delimiter: string,
): OutlineSourceEdit {
  const source = contentToSource(content);
  const { from, to } = selection;
  const wrapped =
    from >= delimiter.length &&
    source.slice(from - delimiter.length, from) === delimiter &&
    source.slice(to, to + delimiter.length) === delimiter;
  return wrapped
    ? {
        from: from - delimiter.length,
        to: to + delimiter.length,
        replacement: sliceContent(content, from, to),
        selection: { from: from - delimiter.length, to: to - delimiter.length },
      }
    : {
        from,
        to,
        replacement: [
          { text: delimiter, type: "text" },
          ...sliceContent(content, from, to),
          { text: delimiter, type: "text" },
        ],
        selection: { from: from + delimiter.length, to: to + delimiter.length },
      };
}
