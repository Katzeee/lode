import type { OutlineCompletionItem } from "../components/outline/outline-tree-edit-contract.js";
import { demoInlineToken } from "./outline-demo-inline.js";
import type { NodeValue } from "./outline-demo-model.js";

export type DemoOutlineCommand = OutlineCompletionItem &
  Readonly<{
    apply?: (value: NodeValue) => NodeValue;
    keywords?: readonly string[];
  }>;

export const demoOutlineCommands: readonly DemoOutlineCommand[] = [
  {
    id: "task",
    label: "Make task",
    description: "Add an actionable checkbox to this node",
    keywords: ["todo"],
    replacement: [],
    apply: (value) => ({ ...value, todo: "open" }),
  },
  {
    id: "project",
    label: "Add #project",
    description: "Apply the #project Supertag",
    keywords: ["tag", "supertag"],
    replacement: [demoInlineToken("supertag", "supertag-project", "project")],
  },
  { id: "bold", label: "Bold", description: "Insert bold source", replacement: [{ text: "**bold**", type: "text" }] },
  {
    id: "italic",
    label: "Italic",
    description: "Insert italic source",
    replacement: [{ text: "__italic__", type: "text" }],
  },
  {
    id: "code",
    label: "Inline code",
    description: "Insert code source",
    replacement: [{ text: "`code`", type: "text" }],
  },
];
