import type { OutlineContent } from "./outline-content.js";
import type { OutlineTreeEditing } from "./outline-tree-edit-contract.js";

export type NodeEditTarget = Readonly<{
  key: string;
  accessibilityLabel: string;
  content: OutlineContent;
  editable?: boolean;
  activation?: "text" | "object" | "navigate";
}>;

export type NodeEditing = Pick<
  OutlineTreeEditing,
  | "onContentChange"
  | "onContentCommit"
  | "completionProviders"
  | "onCompletion"
  | "history"
  | "focusRequest"
  | "emptyPlaceholder"
>;
