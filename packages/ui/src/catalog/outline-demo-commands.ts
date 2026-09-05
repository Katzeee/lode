import type { OutlineCompletionItem } from "../components/outline/outline-tree-edit-contract.js";
import { createElement } from "react";
import { Icon } from "../components/icon.js";
import { demoInlineToken } from "./outline-demo-inline.js";
import { taskCommandIds } from "./outline-demo-task-commands.js";

export type DemoOutlineCommand = OutlineCompletionItem &
  Readonly<{
    keywords?: readonly string[];
  }>;

export const demoOutlineCommands: readonly DemoOutlineCommand[] = [
  {
    id: "task",
    leading: createElement(Icon, { name: "check", size: "sm" }),
    label: "Make task",
    description: "Add an actionable checkbox to this node",
    keywords: ["todo"],
    replacement: [],
    commandId: taskCommandIds.create,
  },
  {
    id: "project",
    leading: createElement("span", { className: "font-medium" }, "#"),
    label: "Add #project",
    description: "Apply the #project Supertag",
    keywords: ["tag", "supertag"],
    replacement: [demoInlineToken("supertag", "supertag-project", "project")],
  },
  {
    id: "bold",
    leading: createElement("strong", null, "B"),
    label: "Bold",
    description: "Insert bold source",
    replacement: [{ text: "**bold**", type: "text" }],
  },
  {
    id: "italic",
    leading: createElement("em", null, "I"),
    label: "Italic",
    description: "Insert italic source",
    replacement: [{ text: "__italic__", type: "text" }],
  },
  {
    id: "code",
    leading: createElement("span", null, "<>"),
    label: "Inline code",
    description: "Insert code source",
    replacement: [{ text: "`code`", type: "text" }],
  },
];
