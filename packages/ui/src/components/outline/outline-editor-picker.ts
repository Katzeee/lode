import type { Editor } from "@tiptap/core";
import { contentToSource, docToContent } from "./outline-content.js";

import type {
  OutlineCompletionContext,
  OutlineCompletionItem,
  OutlineEditorCompletionProvider,
} from "./outline-tree-edit-contract.js";

export type OutlinePickerState = Readonly<{
  from: number;
  provider: OutlineEditorCompletionProvider;
  query: string;
  results: readonly OutlineCompletionItem[];
  to: number;
}>;

export function completionContext(editor: Editor): OutlineCompletionContext | null {
  const { selection } = editor.state;
  const paragraph = selection.$from.parent;
  if (paragraph.type.name !== "paragraph") {
    return null;
  }
  const content = docToContent(editor.getJSON());
  const text = contentToSource(content);
  const from = Math.max(0, selection.from - 1);
  const to = Math.max(0, selection.to - 1);
  return {
    content,
    selection: { from, to },
    text,
    textBeforeCaret: text.slice(0, from),
  } as const;
}

export function completionPicker(
  editor: Editor,
  providers: readonly OutlineEditorCompletionProvider[],
): OutlinePickerState | null {
  const context = completionContext(editor);
  if (context === null) {
    return null;
  }
  for (const provider of providers) {
    const match = provider.match(context);
    if (match === null) {
      continue;
    }
    const results = provider.items(match.query);
    return {
      from: match.from + 1,
      provider,
      query: match.query,
      results,
      to: match.to + 1,
    };
  }
  return null;
}

export function pickerPosition(editor: Editor): Readonly<{
  left: number;
  placement: "above" | "below";
  top: number;
}> {
  const coordinates = editor.view.coordsAtPos(editor.state.selection.from);
  const editorBounds = editor.view.dom.getBoundingClientRect();
  const roomAbove = editorBounds.top;
  const roomBelow = globalThis.innerHeight - editorBounds.bottom;
  const placement = roomBelow >= 240 || roomBelow >= roomAbove ? "below" : "above";
  return {
    left: Math.max(8, Math.min(coordinates.left, globalThis.innerWidth - 296)),
    placement,
    top: placement === "above" ? editorBounds.top - 6 : editorBounds.bottom + 6,
  };
}
