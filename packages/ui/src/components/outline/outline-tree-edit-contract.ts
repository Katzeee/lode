import type { OutlineContent } from "./outline-content.js";
import type { OutlineMerge } from "./outline-tree-view-model.js";

export type OutlineCompletionItem = Readonly<{
  description?: string;
  id: string;
  label: string;
  replacement: OutlineContent;
}>;

export type OutlineCompletionMatch = Readonly<{ from: number; query: string; to: number }>;

export type OutlineCompletionContext = Readonly<{
  selection: Readonly<{ from: number; to: number }>;
  text: string;
  textBeforeCaret: string;
}>;

export type OutlineCompletionProvider = Readonly<{
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
  completionProviders?: readonly OutlineCompletionProvider[];
  emptyPlaceholder?: string;
  onCompletion?: (key: string, providerId: string, itemId: string, content: OutlineContent) => void;
  onContentChange: (key: string, content: OutlineContent) => void;
  onContentCommit: (key: string, content: OutlineContent) => void;
  onCreateAfter: (key: string) => void;
  /** Materializes a child only after the component's empty-child placeholder is activated. */
  onCreateChild?: (key: string) => void;
  onDeleteEmpty: (key: string) => void;
  onMerge?: (merge: OutlineMerge) => void;
  onSplit: (key: string, before: OutlineContent, after: OutlineContent) => void;
}>;

export type OutlineEditorCommand =
  | Readonly<{ content: OutlineContent; from: number; to: number; type: "enter" }>
  | Readonly<{ content: OutlineContent; type: "backspace" | "escape" }>
  | Readonly<{ caret: number | "end"; content: OutlineContent; direction: -1 | 1; type: "navigate" }>
  | Readonly<{
      caret: number;
      content: OutlineContent;
      operation: "indent" | "outdent" | "reorder-down" | "reorder-up";
      type: "structure";
    }>;

export type OutlineEditorCompletionProvider = Readonly<{
  ariaLabel: string;
  emptyLabel: string;
  exitOnSelect?: boolean;
  heading: string;
  id: string;
  items: (query: string) => readonly OutlineCompletionItem[];
  match: (context: OutlineCompletionContext) => OutlineCompletionMatch | null;
  openOnEmptyFocus?: boolean;
}>;

export type OutlineEditorBinding = Readonly<{
  ariaLabel: string;
  completionProviders: readonly OutlineEditorCompletionProvider[];
  content: OutlineContent;
  initialCaret: number;
  onBlur: (content: OutlineContent) => void;
  onChange: (content: OutlineContent) => void;
  onCommand: (command: OutlineEditorCommand) => boolean;
  onCompletion: (providerId: string, itemId: string, content: OutlineContent) => void;
  placeholder: string;
}>;
