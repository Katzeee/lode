import type { OutlineContent } from "./outline-content.js";
import type { ReactNode } from "react";
import type { OutlineEditPosition, OutlineInsertionPlacement, OutlineMerge } from "./outline-tree-view-model.js";
import type { SuggestionItem } from "../suggestion-list/suggestion-list.js";
import type { SuggestionKeyBinding } from "../suggestion-list/suggestion-navigation.js";

export type OutlineCompletionItem = SuggestionItem &
  Readonly<{
    replacement: OutlineContent;
    commandId?: string;
  }>;

export type OutlineCompletionMatch = Readonly<{ from: number; query: string; to: number }>;

export type OutlineCompletionContext = Readonly<{
  content: OutlineContent;
  selection: Readonly<{ from: number; to: number }>;
  text: string;
  textBeforeCaret: string;
}>;

export type OutlineCompletionProvider = Readonly<{
  keyBindings?: readonly SuggestionKeyBinding[];
  canAccept?: (key: string, item: OutlineCompletionItem, context: OutlineCompletionContext) => boolean;
  renderItem?: (item: OutlineCompletionItem, active: boolean) => ReactNode;
  ariaLabel: string;
  emptyLabel: string;
  enabled?: (key: string) => boolean;
  exitOnSelect?: boolean;
  heading: string;
  id: string;
  items: (key: string, query: string) => readonly OutlineCompletionItem[];
  match: (context: OutlineCompletionContext) => OutlineCompletionMatch | null;
  openOnEmptyFocus?: boolean;
}>;

export type OutlineTreeEditing = Readonly<{
  focusRequest?: OutlineEditPosition;
  history?: OutlineEditHistory;
  onCopy?: (keys: readonly string[]) => readonly OutlineClipboardItem[];
  onPaste?: (key: string | null, paste: OutlinePaste) => OutlineEditPosition | null;
  onCreateRoot?: (content: OutlineContent) => OutlineEditPosition;
  completionProviders?: readonly OutlineCompletionProvider[];
  emptyPlaceholder?: string;
  onCompletion?: (
    key: string,
    providerId: string,
    itemId: string,
    content: OutlineContent,
  ) => OutlineEditPosition | void;
  onDuplicate?: (keys: readonly string[]) => OutlineEditPosition | null;
  onContentChange: (key: string, content: OutlineContent) => void;
  onContentCommit: (key: string, content: OutlineContent) => void;
  onCreateBefore: (key: string) => void;
  onCreateAfter: (key: string) => void;
  /** Inserts the first child, including when existing children are expanded. */
  onCreateChild?: (key: string) => void;
  onClearAppearance?: (key: string) => OutlineEditPosition | null;
  onDeleteEmpty: (key: string) => void;
  onMerge?: (merge: OutlineMerge) => void;
  onSplit: (key: string, before: OutlineContent, after: OutlineContent, placement: "after" | "child") => void;
}>;

export type OutlineEditorCommand =
  | Readonly<{
      content: OutlineContent;
      from: number;
      to: number;
      placement?: OutlineInsertionPlacement;
      type: "enter";
    }>
  | Readonly<{ content: OutlineContent; type: "backspace" | "delete" }>
  | Readonly<{ content: OutlineContent; type: "delete-forward" }>
  | Readonly<{ direction: "undo" | "redo"; type: "history" }>
  | Readonly<{ type: "duplicate" }>
  | Readonly<{ content: OutlineContent; expanded: boolean; recursive?: boolean; type: "disclosure" }>
  | Readonly<{ caret: number | "end"; content: OutlineContent; direction: -1 | 1; type: "navigate" }>
  | Readonly<{
      caret: number;
      selectionEnd: number;
      content: OutlineContent;
      operation: "indent" | "outdent" | "reorder-down" | "reorder-up";
      type: "structure";
    }>;

export type OutlineEditorCompletionProvider = Omit<OutlineCompletionProvider, "enabled" | "items" | "canAccept"> &
  Readonly<{
    canAccept?: (item: OutlineCompletionItem, context: OutlineCompletionContext) => boolean;
    items: (query: string) => readonly OutlineCompletionItem[];
  }>;

export type OutlineEditorBinding = Readonly<{
  canExecuteCommand: (id: string) => boolean;
  ariaLabel: string;
  completionProviders: readonly OutlineEditorCompletionProvider[];
  content: OutlineContent;
  initialCaret: number;
  initialSelectionEnd: number;
  revision: number;
  onBlur: (content: OutlineContent, selection: OutlineTextSelection) => void;
  onChange: (content: OutlineContent, before: OutlineTextSelection, group: "typing" | "operation") => void;
  onSelectionChange: (selection: OutlineTextSelection) => void;
  onKeyDown: (event: KeyboardEvent, context: OutlineTextKeyContext) => boolean;
  onCommand: (command: OutlineEditorCommand) => boolean;
  onCompletion: (providerId: string, itemId: string, content: OutlineContent, commandId?: string) => void;
  placeholder: string;
}>;

export type OutlineEditHistory = Readonly<{
  checkpoint: (position: OutlineEditPosition | null, group: "typing" | "operation") => void;
  undo: (
    position: OutlineEditPosition | null,
  ) =>
    | Readonly<{ position: OutlineEditPosition | null }>
    | null
    | Promise<Readonly<{ position: OutlineEditPosition | null }> | null>;
  redo: (
    position: OutlineEditPosition | null,
  ) =>
    | Readonly<{ position: OutlineEditPosition | null }>
    | null
    | Promise<Readonly<{ position: OutlineEditPosition | null }> | null>;
}>;

export type OutlineClipboardItem = Readonly<{
  content: OutlineContent;
  children: readonly OutlineClipboardItem[];
  data?: unknown;
}>;
export type OutlinePaste = Readonly<{
  items: readonly OutlineClipboardItem[];
  selection: OutlineTextSelection;
  placement: "after" | "child";
  replaceEmpty: boolean;
}>;

export type OutlineTextSelection = Readonly<{ from: number; to: number }>;
export type OutlineTextKeyContext = OutlineTextSelection &
  Readonly<{
    content: OutlineContent;
    atTop: boolean;
    atBottom: boolean;
  }>;
