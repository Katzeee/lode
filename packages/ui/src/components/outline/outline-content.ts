/** Source text and externally owned tokens form the portable editing document. */
export type OutlineInline =
  | Readonly<{ text: string; type: "text" }>
  | Readonly<{ data: unknown; extension: string; label: string; source: string; type: "token" }>;
export type OutlineToken = Extract<OutlineInline, { type: "token" }>;
export type OutlineContent = readonly OutlineInline[];
export type OutlineContentSplit = Readonly<{ after: OutlineContent; before: OutlineContent }>;

type EditorInline =
  | { marks?: { attrs: OutlineToken & { instance: string }; type: "outlineToken" }[]; text: string; type: "text" }
  | { type: "hardBreak" };
export type OutlineEditorDocument = {
  content: [{ content?: EditorInline[]; type: "paragraph" }];
  type: "doc";
};

export function inlineSource(inline: OutlineInline): string {
  return inline.type === "text" ? inline.text : inline.source;
}

export function contentToSource(content: OutlineContent): string {
  return content.map(inlineSource).join("");
}

export function normalizeContent(content: OutlineContent): OutlineContent {
  const normalized: OutlineInline[] = [];
  for (const inline of content) {
    if (inline.type === "token") {
      normalized.push(inline);
    } else if (inline.text.length > 0) {
      const previous = normalized.at(-1);
      if (previous?.type === "text") {
        normalized[normalized.length - 1] = { text: previous.text + inline.text, type: "text" };
      } else {
        normalized.push(inline);
      }
    }
  }
  return normalized;
}

export function contentToDoc(content: OutlineContent): OutlineEditorDocument {
  const inline = content.flatMap((item): EditorInline[] => {
    const attrs = item.type === "token" ? { ...item, instance: crypto.randomUUID() } : undefined;
    return inlineSource(item)
      .split("\n")
      .flatMap((text, index): EditorInline[] => [
        ...(index === 0 ? [] : [{ type: "hardBreak" as const }]),
        ...(text.length === 0
          ? []
          : [
              {
                ...(attrs === undefined ? {} : { marks: [{ attrs, type: "outlineToken" as const }] }),
                text,
                type: "text" as const,
              },
            ]),
      ]);
  });
  return { content: [{ ...(inline.length === 0 ? {} : { content: inline }), type: "paragraph" }], type: "doc" };
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null ? (value as Readonly<Record<string, unknown>>) : null;
}

function tokenFrom(value: unknown): OutlineToken | null {
  const token = recordOf(value);
  return token?.type === "token" &&
    typeof token.extension === "string" &&
    typeof token.source === "string" &&
    typeof token.label === "string"
    ? { data: token.data, extension: token.extension, label: token.label, source: token.source, type: "token" }
    : null;
}

export function docToContent(document: unknown): OutlineContent {
  const root = recordOf(document);
  const blocks = root?.type === "doc" && Array.isArray(root.content) ? root.content : [];
  const paragraph = recordOf(blocks[0]);
  const nodes = paragraph?.type === "paragraph" && Array.isArray(paragraph.content) ? paragraph.content : [];
  const content: OutlineInline[] = [];
  let pending: { instance: unknown; text: string; token: OutlineToken | null } | null = null;
  const flush = () => {
    if (pending !== null) {
      // Changing any source character removes its binding; completion explicitly chooses a new identity.
      content.push(pending.token?.source === pending.text ? pending.token : { text: pending.text, type: "text" });
      pending = null;
    }
  };
  for (const candidate of nodes) {
    const node = recordOf(candidate);
    if (node?.type === "hardBreak") {
      flush();
      content.push({ text: "\n", type: "text" });
      continue;
    }
    if (node?.type !== "text" || typeof node.text !== "string") {
      continue;
    }
    const mark = Array.isArray(node.marks)
      ? node.marks.map(recordOf).find((item) => item?.type === "outlineToken")
      : null;
    const token = tokenFrom(mark?.attrs);
    const instance = recordOf(mark?.attrs)?.instance;
    if (
      pending !== null &&
      token !== null &&
      pending.instance === instance &&
      JSON.stringify(pending.token) === JSON.stringify(token)
    ) {
      pending.text += node.text;
    } else {
      flush();
      pending = { instance, text: node.text, token };
    }
  }
  flush();
  return normalizeContent(content);
}

export function contentLength(content: OutlineContent): number {
  return contentToSource(content).length;
}

export function contentToPlainText(content: OutlineContent): string {
  return content.map((inline) => (inline.type === "text" ? inline.text : inline.label)).join("");
}

export function sliceContent(content: OutlineContent, from: number, to: number): OutlineContent {
  const sliced: OutlineInline[] = [];
  let offset = 0;
  for (const inline of content) {
    const source = inlineSource(inline);
    const start = Math.max(0, from - offset);
    const end = Math.min(source.length, to - offset);
    if (start < end) {
      sliced.push(start === 0 && end === source.length ? inline : { text: source.slice(start, end), type: "text" });
    }
    offset += source.length;
  }
  return normalizeContent(sliced);
}

export function splitContent(
  content: OutlineContent,
  selectionStart: number,
  selectionEnd: number,
): OutlineContentSplit {
  const length = contentLength(content);
  const start = Math.max(0, Math.min(selectionStart, length));
  const end = Math.max(start, Math.min(selectionEnd, length));
  return { after: sliceContent(content, end, length), before: sliceContent(content, 0, start) };
}

export function mergeContent(...contents: readonly OutlineContent[]): OutlineContent {
  return normalizeContent(contents.flat());
}

export function appendText(content: OutlineContent, text: string): OutlineContent {
  return mergeContent(content, [{ text, type: "text" }]);
}
