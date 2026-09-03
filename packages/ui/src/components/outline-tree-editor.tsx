import { mergeAttributes, Node as TiptapNode, type Editor } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Code from "@tiptap/extension-code";
import Document from "@tiptap/extension-document";
import Italic from "@tiptap/extension-italic";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { EditorContent, useEditor } from "@tiptap/react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  contentLength,
  contentToDoc,
  docToContent,
  type OutlineContent,
  type OutlineInline,
} from "./outline-content.js";
import { completionPicker, pickerPosition } from "./outline-editor-picker.js";
import { OutlineInlinePicker, type OutlinePickerState } from "./outline-inline-picker.js";
import type {
  OutlineCompletionItem,
  OutlineEditorBinding,
  OutlineEditorCommand,
} from "./outline-tree-edit-contract.js";

const referenceClassName =
  "mx-0.5 inline-flex max-w-full items-center rounded-full border border-primary/15 bg-primary/10 px-1.5 align-middle text-caption font-medium whitespace-normal break-words text-primary";

const SingleLineDocument = Document.extend({ content: "paragraph" });
const SingleLineParagraph = Paragraph.extend({ content: "inline*" });
const OutlineHardBreak = TiptapNode.create({
  group: "inline",
  inline: true,
  name: "hardBreak",
  parseHTML: () => [{ tag: "br" }],
  renderHTML: () => ["br"],
  renderText: () => "\n",
  selectable: false,
});

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

type InlineEditorContextValue = Readonly<{ binding: OutlineEditorBinding | null; placeholder: string }>;

const InlineEditorContext = createContext<InlineEditorContextValue>({ binding: null, placeholder: "" });

export function OutlineInlineEditorProvider({
  binding,
  children,
  placeholder,
}: Readonly<{ binding: OutlineEditorBinding | null; children: ReactNode; placeholder: string }>) {
  return <InlineEditorContext.Provider value={{ binding, placeholder }}>{children}</InlineEditorContext.Provider>;
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
  const { binding, placeholder } = useContext(InlineEditorContext);
  if (binding !== null) {
    return <OutlineTreeEditor binding={binding} />;
  }
  return (
    <span className="inline-block min-h-5.5 whitespace-pre-wrap break-words align-top" data-ui="outline-inline-content">
      {content.length === 0 && placeholder.length > 0 ? (
        <span className="select-none text-muted-foreground" data-ui="outline-placeholder">
          {placeholder}
        </span>
      ) : (
        content.map((inline, index) =>
          inline.type === "reference" ? (
            <span className={referenceClassName} data-reference-id={inline.id} data-ui="outline-reference" key={index}>
              {inline.label}
            </span>
          ) : (
            <MarkedText inline={inline} key={index} />
          ),
        )
      )}
    </span>
  );
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
  if (modified && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    return {
      caret: offsets.from,
      content,
      operation: event.key === "ArrowUp" ? "reorder-up" : "reorder-down",
      type: "structure",
    };
  }
  if (
    !modified &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "ArrowUp" || event.key === "ArrowDown") &&
    editor.view.endOfTextblock(event.key === "ArrowUp" ? "up" : "down")
  ) {
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
  const pickerRef = useRef<OutlinePickerState | null>(null);
  const [empty, setEmpty] = useState(contentLength(binding.content) === 0);
  const [picker, setPickerState] = useState<OutlinePickerState | null>(null);
  bindingRef.current = binding;

  const setPicker = (next: OutlinePickerState | null) => {
    pickerRef.current = next;
    setPickerState(next);
  };

  const syncPicker = (updatedEditor: Editor, providers = bindingRef.current.completionProviders) => {
    setPicker(completionPicker(updatedEditor, providers, pickerRef.current));
  };

  const selectCompletion = (item: OutlineCompletionItem) => {
    const activeEditor = editorRef.current;
    const activePicker = pickerRef.current;
    if (activeEditor === null || activePicker === null) {
      return;
    }
    const replacement = contentToDoc(item.replacement).content?.[0]?.content ?? [];
    const chain = activeEditor.chain().focus();
    if (replacement.length === 0) {
      chain.deleteRange({ from: activePicker.from, to: activePicker.to }).run();
    } else {
      chain.insertContentAt({ from: activePicker.from, to: activePicker.to }, replacement).run();
    }
    const content = currentContent(activeEditor);
    setPicker(null);
    bindingRef.current.onCompletion(activePicker.provider.id, item.id, content);
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
    if (event.key === "Enter" && event.shiftKey) {
      activeEditor.chain().focus().insertContent({ type: "hardBreak" }).run();
      setPicker(null);
      return true;
    }
    if (activePicker !== null && event.key === "Enter" && activePicker.results.length > 0) {
      const result = activePicker.results[activePicker.activeIndex];
      if (result !== undefined) {
        selectCompletion(result);
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
        class:
          "inline-block w-max min-w-24 max-w-full whitespace-pre-wrap break-words text-body text-current outline-none",
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
    extensions: [SingleLineDocument, SingleLineParagraph, Text, Bold, Italic, Code, OutlineHardBreak, OutlineReference],
    immediatelyRender: true,
    onSelectionUpdate: ({ editor: updatedEditor }) =>
      syncPicker(updatedEditor, pickerRef.current === null ? [] : [pickerRef.current.provider]),
    onUpdate: ({ editor: updatedEditor }) => {
      const content = currentContent(updatedEditor);
      setEmpty(contentLength(content) === 0);
      bindingRef.current.onChange(content);
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
    if (JSON.stringify(currentContent(editor)) !== JSON.stringify(binding.content)) {
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
      if (editor.isDestroyed) {
        return;
      }
      if (!editor.view.hasFocus()) {
        editor.view.focus();
      }
      if (contentLength(currentContent(editor)) === 0) {
        syncPicker(
          editor,
          bindingRef.current.completionProviders.filter((provider) => provider.openOnEmptyFocus === true),
        );
      }
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [binding.content, editor]);

  return (
    <>
      <div className={`relative inline-flex min-w-24 max-w-full align-top ${empty ? "w-full" : "w-max"}`}>
        <EditorContent
          className="inline-flex w-max min-w-24 max-w-full"
          editor={editor}
          onClick={(event) => event.stopPropagation()}
        />
        {empty ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 truncate whitespace-nowrap text-body text-muted-foreground"
            data-ui="outline-placeholder"
          >
            {binding.placeholder}
          </span>
        ) : null}
      </div>
      <OutlineInlinePicker elementRef={pickerElementRef} onSelect={selectCompletion} picker={picker} />
    </>
  );
}
