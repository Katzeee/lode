import type { Editor } from "@tiptap/core";
import { contentToSource, docToContent } from "./outline-content.js";

import type { OutlinePickerState } from "./outline-inline-picker.js";
import type { OutlineEditorCompletionProvider } from "./outline-tree-edit-contract.js";

export function completionPicker(
  editor: Editor,
  providers: readonly OutlineEditorCompletionProvider[],
  current: OutlinePickerState | null,
): OutlinePickerState | null {
  const { selection } = editor.state;
  const paragraph = selection.$from.parent;
  if (paragraph.type.name !== "paragraph") {
    return null;
  }
  const content = docToContent(editor.getJSON());
  const text = contentToSource(content);
  const from = Math.max(0, selection.from - 1);
  const to = Math.max(0, selection.to - 1);
  const context = {
    content,
    selection: { from, to },
    text,
    textBeforeCaret: text.slice(0, from),
  } as const;
  for (const provider of providers) {
    const match = provider.match(context);
    if (match === null) {
      continue;
    }
    const results = provider.items(match.query.trim());
    const activeIndex =
      current?.provider.id === provider.id && current.query === match.query
        ? Math.min(current.activeIndex, Math.max(0, results.length - 1))
        : 0;
    return {
      activeIndex,
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
