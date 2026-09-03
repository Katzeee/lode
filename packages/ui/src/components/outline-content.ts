export type OutlineMark = "bold" | "code" | "italic";

export type OutlineInline =
  | Readonly<{ marks?: readonly OutlineMark[]; text: string; type: "text" }>
  | Readonly<{ id: string; label: string; type: "reference" }>;

export type OutlineContent = readonly OutlineInline[];

type EditorMark = { type: OutlineMark };
type EditorInline =
  | { marks?: EditorMark[]; type: "hardBreak" }
  | { marks?: EditorMark[]; text: string; type: "text" }
  | { attrs: { id: string; label: string }; type: "outlineReference" };

export type OutlineEditorDocument = {
  content: [{ content?: EditorInline[]; type: "paragraph" }];
  type: "doc";
};

export type OutlineContentSplit = Readonly<{ after: OutlineContent; before: OutlineContent }>;

const markOrder: readonly OutlineMark[] = ["bold", "italic", "code"];

function normalizedMarks(marks: readonly OutlineMark[] | undefined): readonly OutlineMark[] | undefined {
  const normalized = markOrder.filter((mark) => marks?.includes(mark) === true);
  return normalized.length === 0 ? undefined : normalized;
}

function sameMarks(left: readonly OutlineMark[] | undefined, right: readonly OutlineMark[] | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.length === right.length && left.every((mark, index) => mark === right[index]);
}

export function normalizeContent(content: OutlineContent): OutlineContent {
  const normalized: OutlineInline[] = [];
  for (const inline of content) {
    if (inline.type === "reference") {
      normalized.push(inline);
      continue;
    }
    if (inline.text.length === 0) {
      continue;
    }
    const marks = normalizedMarks(inline.marks);
    const previous = normalized.at(-1);
    if (previous?.type === "text" && sameMarks(previous.marks, marks)) {
      normalized[normalized.length - 1] = { marks, text: `${previous.text}${inline.text}`, type: "text" };
    } else {
      normalized.push({ marks, text: inline.text, type: "text" });
    }
  }
  return normalized;
}

export function contentToDoc(content: OutlineContent): OutlineEditorDocument {
  const inline = normalizeContent(content).flatMap((item): EditorInline[] => {
    if (item.type === "reference") {
      return [{ attrs: { id: item.id, label: item.label }, type: "outlineReference" }];
    }
    const marks = item.marks?.map((mark) => ({ type: mark }));
    return item.text
      .split("\n")
      .flatMap((text, index): EditorInline[] => [
        ...(index === 0 ? [] : [{ marks, type: "hardBreak" as const }]),
        ...(text.length === 0 ? [] : [{ marks, text, type: "text" as const }]),
      ]);
  });
  return { content: [{ ...(inline.length === 0 ? {} : { content: inline }), type: "paragraph" }], type: "doc" };
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null ? (value as Readonly<Record<string, unknown>>) : null;
}

function marksFrom(value: unknown): readonly OutlineMark[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const marks = value.flatMap((candidate): OutlineMark[] => {
    const type = recordOf(candidate)?.type;
    return type === "bold" || type === "italic" || type === "code" ? [type] : [];
  });
  return normalizedMarks(marks);
}

export function docToContent(document: unknown): OutlineContent {
  const root = recordOf(document);
  const blocks = root?.type === "doc" && Array.isArray(root.content) ? root.content : [];
  const paragraph = recordOf(blocks[0]);
  const nodes = paragraph?.type === "paragraph" && Array.isArray(paragraph.content) ? paragraph.content : [];
  const content = nodes.flatMap((candidate): OutlineInline[] => {
    const node = recordOf(candidate);
    if (node?.type === "text" && typeof node.text === "string") {
      return [{ marks: marksFrom(node.marks), text: node.text, type: "text" }];
    }
    if (node?.type === "hardBreak") {
      return [{ marks: marksFrom(node.marks), text: "\n", type: "text" }];
    }
    const attributes = recordOf(node?.attrs);
    return node?.type === "outlineReference" &&
      typeof attributes?.id === "string" &&
      typeof attributes.label === "string"
      ? [{ id: attributes.id, label: attributes.label, type: "reference" }]
      : [];
  });
  return normalizeContent(content);
}

export function contentLength(content: OutlineContent): number {
  return content.reduce((length, inline) => length + (inline.type === "text" ? inline.text.length : 1), 0);
}

export function contentToPlainText(content: OutlineContent): string {
  return content.map((inline) => (inline.type === "text" ? inline.text : inline.label)).join("");
}

function sliceContent(content: OutlineContent, from: number, to: number): OutlineContent {
  const sliced: OutlineInline[] = [];
  let offset = 0;
  for (const inline of content) {
    const length = inline.type === "text" ? inline.text.length : 1;
    const start = Math.max(0, from - offset);
    const end = Math.min(length, to - offset);
    if (start < end) {
      sliced.push(inline.type === "text" ? { ...inline, text: inline.text.slice(start, end) } : inline);
    }
    offset += length;
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
  return text.length === 0 ? content : mergeContent(content, [{ text, type: "text" }]);
}
