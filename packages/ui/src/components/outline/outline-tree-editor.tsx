import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { contentLength, contentToDoc, docToContent, type OutlineContent } from "./outline-content.js";
import { sourceSelection } from "./outline-caret.js";
import { outlineEditorDocument } from "./outline-editor-document.js";
import { OutlineSourceContent, useOutlineInlineExtensions } from "./outline-source-content.js";
import type { OutlineSourceEdit } from "./outline-inline-extension.js";
import {
  completionContext,
  completionPicker,
  pickerPosition,
  type OutlinePickerState,
} from "./outline-editor-picker.js";
import { SuggestionList, useSuggestionList } from "../suggestion-list/suggestion-list.js";
import type {
  OutlineCompletionItem,
  OutlineEditorBinding,
  OutlineEditorCommand,
} from "./outline-tree-edit-contract.js";

type InlineEditorContextValue = Readonly<{ binding: OutlineEditorBinding | null; placeholder: string }>;

const InlineEditorContext = createContext<InlineEditorContextValue>({ binding: null, placeholder: "" });

export function OutlineInlineEditorProvider({
  binding,
  children,
  placeholder,
}: Readonly<{ binding: OutlineEditorBinding | null; children: ReactNode; placeholder: string }>) {
  return <InlineEditorContext.Provider value={{ binding, placeholder }}>{children}</InlineEditorContext.Provider>;
}

export function OutlineInlineContent({ content }: Readonly<{ content: OutlineContent }>) {
  const { binding, placeholder } = useContext(InlineEditorContext);
  if (binding !== null) {
    return <OutlineTreeEditor binding={binding} />;
  }
  return (
    <span className="inline-block min-h-lh whitespace-pre-wrap break-words align-top" data-ui="outline-inline-content">
      {content.length === 0 && placeholder.length > 0 ? (
        <span className="select-none text-muted-foreground" data-ui="outline-placeholder">
          {placeholder}
        </span>
      ) : (
        <OutlineSourceContent content={content} />
      )}
    </span>
  );
}

function currentContent(editor: Editor): OutlineContent {
  return docToContent(editor.getJSON());
}

function selectionOffsets(editor: Editor): Readonly<{ from: number; to: number }> {
  return (
    sourceSelection(editor.view.dom) ?? {
      from: Math.max(0, editor.state.selection.from - 1),
      to: Math.max(0, editor.state.selection.to - 1),
    }
  );
}

function editorCommand(editor: Editor, event: KeyboardEvent): OutlineEditorCommand | null {
  const content = currentContent(editor);
  const offsets = selectionOffsets(editor);
  const modified = event.ctrlKey || event.metaKey;
  if (event.altKey && event.shiftKey && !modified && event.key.toLowerCase() === "d") {
    return { type: "duplicate" };
  }
  if (modified && !event.altKey && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
    return { type: "history", direction: event.shiftKey || event.key.toLowerCase() === "y" ? "redo" : "undo" };
  }
  if (modified && event.shiftKey && !event.altKey && event.key === "Backspace") {
    return { content, type: "delete" };
  }
  if (modified && event.shiftKey && !event.altKey && (event.key === "PageUp" || event.key === "PageDown")) {
    return { content, expanded: event.key === "PageDown", recursive: true, type: "disclosure" };
  }
  if (event.key === "Enter") {
    if (modified && !event.shiftKey) {
      return null;
    }
    return {
      content,
      ...offsets,
      placement: modified ? "before" : event.shiftKey ? "after" : undefined,
      type: "enter",
    };
  }
  if (event.key === "Tab" && !modified && !event.altKey) {
    return {
      caret: offsets.from,
      selectionEnd: offsets.to,
      content,
      operation: event.shiftKey ? "outdent" : "indent",
      type: "structure",
    };
  }
  if (event.altKey && event.shiftKey && !modified && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    return {
      caret: offsets.from,
      selectionEnd: offsets.to,
      content,
      operation: event.key === "ArrowUp" ? "reorder-up" : "reorder-down",
      type: "structure",
    };
  }
  if (modified && !event.altKey && !event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    return { content, expanded: event.key === "ArrowDown", type: "disclosure" };
  }
  if (
    !modified &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "ArrowUp" || event.key === "ArrowDown") &&
    editor.view.endOfTextblock(event.key === "ArrowUp" ? "up" : "down")
  ) {
    return { caret: 0, content, direction: event.key === "ArrowUp" ? -1 : 1, type: "navigate" };
  }
  const plainArrow = !modified && !event.altKey && !event.shiftKey && editor.state.selection.empty;
  if (event.key === "ArrowLeft" && plainArrow && offsets.from === 0) {
    return { caret: "end", content, direction: -1, type: "navigate" };
  }
  if (event.key === "ArrowRight" && plainArrow && offsets.from === contentLength(content)) {
    return { caret: 0, content, direction: 1, type: "navigate" };
  }
  if (
    event.key === "Backspace" &&
    !modified &&
    !event.altKey &&
    !event.shiftKey &&
    editor.state.selection.empty &&
    offsets.from === 0
  ) {
    return { content, type: "backspace" };
  }
  if (
    event.key === "Delete" &&
    !modified &&
    !event.altKey &&
    !event.shiftKey &&
    editor.state.selection.empty &&
    offsets.to === contentLength(content)
  ) {
    return { content, type: "delete-forward" };
  }
  return null;
}

function replaceSource(editor: Editor, edit: OutlineSourceEdit) {
  const replacement = contentToDoc(edit.replacement).content[0].content ?? [];
  const chain = editor.chain().focus();
  const range = { from: edit.from + 1, to: edit.to + 1 };
  if (replacement.length === 0) {
    chain.deleteRange(range);
  } else {
    chain.insertContentAt(range, replacement);
  }
  if (edit.selection !== undefined) {
    chain.setTextSelection({ from: edit.selection.from + 1, to: edit.selection.to + 1 });
  }
  chain
    .command(({ tr }) => {
      tr.setStoredMarks([]);
      return true;
    })
    .run();
}

function OutlineTreeEditor({ binding }: Readonly<{ binding: OutlineEditorBinding }>) {
  const extensions = useOutlineInlineExtensions();
  const extensionsRef = useRef(extensions);
  extensionsRef.current = extensions;
  const bindingRef = useRef(binding);
  const editorRef = useRef<Editor | null>(null);
  const pickerElementRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<OutlinePickerState | null>(null);
  const completingRef = useRef(false);
  const operationRef = useRef(false);
  const [empty, setEmpty] = useState(contentLength(binding.content) === 0);
  const [picker, setPickerState] = useState<OutlinePickerState | null>(null);
  bindingRef.current = binding;

  const setPicker = (next: OutlinePickerState | null) => {
    pickerRef.current = next;
    setPickerState(next);
  };

  const syncPicker = (updatedEditor: Editor, providers = bindingRef.current.completionProviders) => {
    setPicker(completionPicker(updatedEditor, providers));
  };

  const selectCompletion = (item: OutlineCompletionItem) => {
    const activeEditor = editorRef.current;
    const activePicker = pickerRef.current;
    if (activeEditor === null || activePicker === null) {
      return;
    }
    // Completion is one semantic edit; publishing its replacement first can mutate the previous target.
    completingRef.current = true;
    try {
      replaceSource(activeEditor, {
        from: activePicker.from - 1,
        to: activePicker.to - 1,
        replacement: item.replacement,
      });
    } finally {
      completingRef.current = false;
    }
    const content = currentContent(activeEditor);
    setPicker(null);
    bindingRef.current.onCompletion(activePicker.provider.id, item.id, content, item.commandId);
  };

  const suggestions = useSuggestionList({
    items: picker?.results ?? [],
    sessionKey: picker === null ? null : JSON.stringify([picker.provider.id, picker.from, picker.query]),
    keyBindings: picker?.provider.keyBindings,
    canAccept: (item) => {
      if (item.commandId !== undefined && !bindingRef.current.canExecuteCommand(item.commandId)) {
        return false;
      }
      const activeEditor = editorRef.current;
      const context = activeEditor === null ? null : completionContext(activeEditor);
      return context !== null && pickerRef.current?.provider.canAccept?.(item, context) !== false;
    },
    onAccept: selectCompletion,
    onDismiss: () => setPicker(null),
  });

  const handleKeyDown = (activeEditor: Editor, event: KeyboardEvent): boolean => {
    event.stopPropagation();
    if (activeEditor.view.composing || event.isComposing) {
      return false;
    }
    if (suggestions.handleKeyDown(event)) {
      return true;
    }
    if (
      bindingRef.current.onKeyDown(event, {
        ...selectionOffsets(activeEditor),
        content: currentContent(activeEditor),
        atTop: activeEditor.view.endOfTextblock("up"),
        atBottom: activeEditor.view.endOfTextblock("down"),
      })
    ) {
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      const extension = extensionsRef.current.find((candidate) => candidate.shortcut?.key === event.key.toLowerCase());
      if (extension?.shortcut !== undefined) {
        operationRef.current = true;
        try {
          replaceSource(
            activeEditor,
            extension.shortcut.apply(currentContent(activeEditor), selectionOffsets(activeEditor)),
          );
        } finally {
          operationRef.current = false;
        }
        return true;
      }
    }
    const command = editorCommand(activeEditor, event);
    return command === null ? false : bindingRef.current.onCommand(command);
  };

  const editor = useEditor({
    content: contentToDoc(binding.content),
    editorProps: {
      attributes: {
        "aria-label": binding.ariaLabel,
        "aria-autocomplete": "list",
        "aria-haspopup": "listbox",
        "aria-multiline": "true",
        role: "textbox",
        class:
          "inline-block w-max max-w-full whitespace-pre-wrap break-words text-document-body text-current outline-none",
        "data-ui": "outline-editor",
      },
      handleDOMEvents: {
        cut: () => {
          operationRef.current = true;
          return false;
        },
        paste: () => {
          operationRef.current = true;
          return false;
        },
        blur: (view) => {
          const content = docToContent(view.state.doc.toJSON());
          const selection = {
            from: Math.max(0, view.state.selection.from - 1),
            to: Math.max(0, view.state.selection.to - 1),
          };
          // React can detach and reattach EditorContent in the same commit. Only a
          // settled focus departure ends the session; a structural handoff does not.
          queueMicrotask(() => {
            if (view.dom.isConnected && !view.hasFocus()) {
              bindingRef.current.onBlur(content, selection);
            }
          });
          return false;
        },
      },
      handleKeyDown: (_view, event) => {
        const activeEditor = editorRef.current;
        return activeEditor === null ? false : handleKeyDown(activeEditor, event);
      },
    },
    extensions: outlineEditorDocument,
    immediatelyRender: true,
    onSelectionUpdate: ({ editor: updatedEditor }) => {
      bindingRef.current.onSelectionChange(selectionOffsets(updatedEditor));
      syncPicker(updatedEditor, pickerRef.current === null ? [] : [pickerRef.current.provider]);
    },
    onUpdate: ({ editor: updatedEditor, transaction }) => {
      const content = currentContent(updatedEditor);
      setEmpty(contentLength(content) === 0);
      if (completingRef.current) {
        return;
      }
      const inverse = transaction.mapping.invert();
      bindingRef.current.onChange(
        content,
        {
          from: Math.max(0, inverse.map(updatedEditor.state.selection.from) - 1),
          to: Math.max(0, inverse.map(updatedEditor.state.selection.to) - 1),
        },
        operationRef.current ? "operation" : "typing",
      );
      operationRef.current = false;
      syncPicker(updatedEditor);
    },
  });
  editorRef.current = editor;
  const pickerOpen = picker !== null;

  useLayoutEffect(() => {
    if (editor === null) {
      return;
    }
    const element = editor.view.dom;
    if (pickerOpen) {
      element.setAttribute("aria-controls", suggestions.listId);
    } else {
      element.removeAttribute("aria-controls");
    }
    if (pickerOpen && suggestions.activeId !== null) {
      element.setAttribute("aria-activedescendant", suggestions.optionId(suggestions.activeId));
    } else {
      element.removeAttribute("aria-activedescendant");
    }
  }, [editor, pickerOpen, suggestions.activeId, suggestions.listId]);

  useLayoutEffect(() => {
    const providerId = pickerRef.current?.provider.id;
    if (editor !== null && providerId !== undefined) {
      syncPicker(
        editor,
        binding.completionProviders.filter((provider) => provider.id === providerId),
      );
    }
  }, [binding.completionProviders, editor]);

  useLayoutEffect(() => {
    if (editor === null) {
      return;
    }
    // Tiptap owns this DOM node; only an empty editor needs a stable hit target.
    editor.view.dom.classList.toggle("min-w-24", empty);
  }, [editor, empty]);

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
      editor.commands.setContent(contentToDoc(binding.content), { emitUpdate: false });
    }
    const position = Math.max(1, Math.min(binding.initialCaret + 1, editor.state.doc.content.size - 1));
    const end = Math.max(position, Math.min(binding.initialSelectionEnd + 1, editor.state.doc.content.size - 1));
    editor.commands.setTextSelection({ from: position, to: end });
    editor.view.focus();
  }, [binding.revision, editor]);

  useEffect(() => {
    if (editor === null) {
      return;
    }
    const timer = globalThis.setTimeout(() => {
      if (editor.isDestroyed) {
        return;
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
      <div className={`relative inline-flex max-w-full align-top ${empty ? "w-full min-w-24" : "w-max"}`}>
        <EditorContent
          className={`inline-flex max-w-full ${empty ? "w-full min-w-24" : "w-max"}`}
          editor={editor}
          onClick={(event) => event.stopPropagation()}
        />
        {empty ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 truncate whitespace-nowrap text-document-body text-muted-foreground"
            data-ui="outline-placeholder"
          >
            {binding.placeholder}
          </span>
        ) : null}
      </div>
      {picker === null ? null : (
        <SuggestionList
          controller={suggestions}
          emptyLabel={picker.provider.emptyLabel}
          heading={picker.provider.heading}
          items={picker.results}
          label={picker.provider.ariaLabel}
          panelRef={pickerElementRef}
          renderItem={picker.provider.renderItem}
        />
      )}
    </>
  );
}
