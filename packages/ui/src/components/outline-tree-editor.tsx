import { mergeAttributes, Node as TiptapNode, type Editor } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Code from "@tiptap/extension-code";
import Document from "@tiptap/extension-document";
import Italic from "@tiptap/extension-italic";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { EditorContent, useEditor } from "@tiptap/react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  contentLength,
  contentToDoc,
  docToContent,
  type OutlineContent,
  type OutlineInline,
} from "./outline-content.js";
import { menuItemClassName, menuPopupClassName } from "./dropdown-menu.js";
import type { OutlineEditorBinding, OutlineEditorCommand, OutlineReferenceSearchResult } from "./outline-tree-edit.js";

const referenceClassName =
  "inline-flex items-center rounded-full border border-transparent bg-accent px-1.5 text-caption font-medium whitespace-nowrap text-accent-foreground";

const SingleLineDocument = Document.extend({ content: "paragraph" });
const SingleLineParagraph = Paragraph.extend({ content: "inline*" });

const OutlineReference = TiptapNode.create({
  addAttributes() {
    return {
      id: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-reference-id") ?? "",
        renderHTML: (attributes) => ({ "data-reference-id": String(attributes.id ?? "") }),
      },
      label: {
        default: "",
        parseHTML: (element) => element.textContent ?? "",
        renderHTML: () => ({}),
      },
    };
  },
  atom: true,
  group: "inline",
  inline: true,
  name: "outlineReference",
  parseHTML() {
    return [{ tag: 'span[data-ui="outline-reference"]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: referenceClassName,
        contenteditable: "false",
        "data-ui": "outline-reference",
      }),
      String(node.attrs.label ?? ""),
    ];
  },
  renderText({ node }) {
    return String(node.attrs.label ?? "");
  },
  selectable: true,
});

type PickerState = Readonly<{
  activeIndex: number;
  from: number;
  query: string;
  results: readonly OutlineReferenceSearchResult[];
  to: number;
}>;

type PickerPosition = Readonly<{ left: number; placement: "above" | "below"; top: number }>;

const InlineEditorContext = createContext<OutlineEditorBinding | null>(null);

export function OutlineInlineEditorProvider({
  binding,
  children,
}: Readonly<{ binding: OutlineEditorBinding | null; children: ReactNode }>) {
  return <InlineEditorContext.Provider value={binding}>{children}</InlineEditorContext.Provider>;
}

function MarkedText({ inline }: Readonly<{ inline: Extract<OutlineInline, { type: "text" }> }>) {
  let rendered: ReactNode = inline.text;
  if (inline.marks?.includes("code") === true) {
    rendered = <code>{rendered}</code>;
  }
  if (inline.marks?.includes("italic") === true) {
    rendered = <em>{rendered}</em>;
  }
  if (inline.marks?.includes("bold") === true) {
    rendered = <strong>{rendered}</strong>;
  }
  return rendered;
}

export function OutlineInlineContent({ content }: Readonly<{ content: OutlineContent }>) {
  const binding = useContext(InlineEditorContext);
  if (binding !== null) {
    return <OutlineTreeEditor binding={binding} />;
  }
  return (
    <span data-ui="outline-inline-content">
      {content.map((inline, index) =>
        inline.type === "reference" ? (
          <span className={referenceClassName} data-reference-id={inline.id} data-ui="outline-reference" key={index}>
            {inline.label}
          </span>
        ) : (
          <MarkedText inline={inline} key={index} />
        ),
      )}
    </span>
  );
}

function referenceQuery(editor: Editor): Omit<PickerState, "activeIndex" | "results"> | null {
  const { selection } = editor.state;
  if (!selection.empty || selection.$from.parent.type.name !== "paragraph") {
    return null;
  }
  const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, "", "");
  const match = /(\[\[|@)([^\u005B\u005D@\n]*)$/.exec(before);
  const trigger = match?.[1];
  const query = match?.[2];
  if (match === null || match === undefined || trigger === undefined || query === undefined) {
    return null;
  }
  return {
    from: selection.from - trigger.length - query.length,
    query,
    to: selection.from,
  };
}

function pickerPosition(editor: Editor): PickerPosition {
  const coordinates = editor.view.coordsAtPos(editor.state.selection.from);
  const editorBounds = editor.view.dom.getBoundingClientRect();
  const roomAbove = editorBounds.top;
  const roomBelow = globalThis.innerHeight - editorBounds.bottom;
  const placement = roomBelow >= 240 || roomBelow >= roomAbove ? "below" : "above";
  return {
    left: Math.max(8, Math.min(coordinates.left, globalThis.innerWidth - 328)),
    placement,
    top: placement === "above" ? editorBounds.top - 6 : editorBounds.bottom + 6,
  };
}

function currentContent(editor: Editor): OutlineContent {
  return docToContent(editor.getJSON());
}

function selectionOffsets(editor: Editor): Readonly<{ from: number; to: number }> {
  return {
    from: Math.max(0, editor.state.selection.from - 1),
    to: Math.max(0, editor.state.selection.to - 1),
  };
}

function editorCommand(editor: Editor, event: KeyboardEvent): OutlineEditorCommand | null {
  const content = currentContent(editor);
  const offsets = selectionOffsets(editor);
  const modified = event.ctrlKey || event.metaKey;
  if (event.key === "Enter") {
    return { content, ...offsets, type: "enter" };
  }
  if (event.key === "Escape") {
    return { content, type: "escape" };
  }
  if (event.key === "Tab") {
    return { caret: offsets.from, content, operation: event.shiftKey ? "outdent" : "indent", type: "structure" };
  }
  if (modified && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    return {
      caret: offsets.from,
      content,
      operation: event.key === "ArrowUp" ? "reorder-up" : "reorder-down",
      type: "structure",
    };
  }
  if (!modified && !event.altKey && !event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    return { caret: offsets.from, content, direction: event.key === "ArrowUp" ? -1 : 1, type: "navigate" };
  }
  if (event.key === "ArrowLeft" && editor.state.selection.empty && offsets.from === 0) {
    return { caret: "end", content, direction: -1, type: "navigate" };
  }
  if (event.key === "ArrowRight" && editor.state.selection.empty && offsets.from === contentLength(content)) {
    return { caret: 0, content, direction: 1, type: "navigate" };
  }
  if (event.key === "Backspace" && editor.state.selection.empty && offsets.from === 0) {
    return { content, type: "backspace" };
  }
  return null;
}

function OutlineTreeEditor({ binding }: Readonly<{ binding: OutlineEditorBinding }>) {
  const bindingRef = useRef(binding);
  const editorRef = useRef<Editor | null>(null);
  const pickerElementRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<PickerState | null>(null);
  const [picker, setPickerState] = useState<PickerState | null>(null);
  bindingRef.current = binding;

  const setPicker = (next: PickerState | null) => {
    pickerRef.current = next;
    setPickerState(next);
  };

  const syncPicker = (updatedEditor: Editor) => {
    const match = referenceQuery(updatedEditor);
    if (match === null) {
      setPicker(null);
      return;
    }
    const results = bindingRef.current.searchNodes(match.query.trim());
    const currentPicker = pickerRef.current;
    const activeIndex =
      currentPicker?.query === match.query ? Math.min(currentPicker.activeIndex, Math.max(0, results.length - 1)) : 0;
    setPicker({ ...match, activeIndex, results });
  };

  const selectReference = (result: OutlineReferenceSearchResult) => {
    const activeEditor = editorRef.current;
    const activePicker = pickerRef.current;
    if (activeEditor === null || activePicker === null) {
      return;
    }
    activeEditor
      .chain()
      .focus()
      .insertContentAt({ from: activePicker.from, to: activePicker.to }, { attrs: result, type: "outlineReference" })
      .run();
    setPicker(null);
  };

  const handleKeyDown = (activeEditor: Editor, event: KeyboardEvent): boolean => {
    event.stopPropagation();
    if (activeEditor.view.composing || event.isComposing) {
      return false;
    }
    const activePicker = pickerRef.current;
    if (activePicker !== null && event.key === "Escape") {
      setPicker(null);
      return true;
    }
    if (activePicker !== null && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const count = activePicker.results.length;
      setPicker({ ...activePicker, activeIndex: count === 0 ? 0 : (activePicker.activeIndex + delta + count) % count });
      return true;
    }
    if (activePicker !== null && event.key === "Enter") {
      const result = activePicker.results[activePicker.activeIndex];
      if (result !== undefined) {
        selectReference(result);
      }
      return true;
    }
    if (
      event.key === "Backspace" &&
      activeEditor.state.selection.empty &&
      activeEditor.state.selection.$from.nodeBefore?.type.name === "outlineReference"
    ) {
      const position = activeEditor.state.selection.from;
      activeEditor.view.dispatch(activeEditor.state.tr.delete(position - 1, position));
      return true;
    }
    const command = editorCommand(activeEditor, event);
    return command === null ? false : bindingRef.current.onCommand(command);
  };

  const editor = useEditor({
    content: contentToDoc(binding.content),
    editorProps: {
      attributes: {
        "aria-label": binding.ariaLabel,
        class: "min-w-0 whitespace-pre text-body text-current outline-none",
        "data-ui": "outline-editor",
      },
      handleDOMEvents: {
        blur: (view) => {
          bindingRef.current.onBlur(docToContent(view.state.doc.toJSON()));
          return false;
        },
      },
      handleKeyDown: (_view, event) => {
        const activeEditor = editorRef.current;
        return activeEditor === null ? false : handleKeyDown(activeEditor, event);
      },
    },
    extensions: [SingleLineDocument, SingleLineParagraph, Text, Bold, Italic, Code, OutlineReference],
    immediatelyRender: true,
    onSelectionUpdate: ({ editor: updatedEditor }) => syncPicker(updatedEditor),
    onUpdate: ({ editor: updatedEditor }) => {
      bindingRef.current.onChange(currentContent(updatedEditor));
      syncPicker(updatedEditor);
    },
  });
  editorRef.current = editor;
  const pickerOpen = picker !== null;

  useEffect(() => {
    if (editor === null || !pickerOpen) {
      return;
    }
    const updatePosition = () => {
      const element = pickerElementRef.current;
      if (editor.isDestroyed || element === null) {
        return;
      }
      const position = pickerPosition(editor);
      element.style.left = `${String(position.left)}px`;
      element.style.top = `${String(position.top)}px`;
      element.style.transform = position.placement === "above" ? "translateY(-100%)" : "";
    };
    updatePosition();
    const layoutTimer = globalThis.setTimeout(updatePosition, 0);
    const settledTimer = globalThis.setTimeout(updatePosition, 50);
    globalThis.addEventListener("resize", updatePosition);
    globalThis.addEventListener("scroll", updatePosition, true);
    return () => {
      globalThis.clearTimeout(layoutTimer);
      globalThis.clearTimeout(settledTimer);
      globalThis.removeEventListener("resize", updatePosition);
      globalThis.removeEventListener("scroll", updatePosition, true);
    };
  }, [editor, pickerOpen]);

  useLayoutEffect(() => {
    if (editor === null) {
      return;
    }
    const position = Math.min(binding.initialCaret + 1, editor.state.doc.content.size - 1);
    editor.commands.setTextSelection(position);
  }, [binding.initialCaret, editor]);

  useEffect(() => {
    if (editor === null) {
      return;
    }
    // Strict Mode remounts EditorContent once in development. Focusing in the
    // next task prevents its transient unmount from ending the session.
    const timer = globalThis.setTimeout(() => {
      if (editor.isDestroyed || editor.view.hasFocus()) {
        return;
      }
      editor.view.focus();
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [editor]);

  return (
    <>
      <EditorContent className="min-w-0 flex-1" editor={editor} onClick={(event) => event.stopPropagation()} />
      {picker === null
        ? null
        : createPortal(
            <div
              aria-label="References"
              className={`${menuPopupClassName} fixed z-50 max-h-56 max-w-80 overflow-y-auto`}
              onMouseDown={(event) => event.preventDefault()}
              ref={pickerElementRef}
              role="listbox"
            >
              {picker.results.length === 0 ? (
                <div className="px-2.5 py-2 text-label text-muted-foreground">No matching nodes</div>
              ) : (
                picker.results.map((result, index) => (
                  <button
                    aria-selected={index === picker.activeIndex}
                    className={menuItemClassName(undefined)}
                    data-highlighted={index === picker.activeIndex ? "" : undefined}
                    key={result.id}
                    onClick={() => selectReference(result)}
                    onMouseDown={(event) => event.preventDefault()}
                    role="option"
                    tabIndex={-1}
                    type="button"
                  >
                    {result.label}
                  </button>
                ))
              )}
            </div>,
            document.body,
            "outline-reference-picker",
          )}
    </>
  );
}
