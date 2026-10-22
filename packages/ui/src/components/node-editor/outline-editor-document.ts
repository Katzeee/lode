import { Extension, Mark, Node } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { history, redo, undo } from "@tiptap/pm/history";

const Token = Mark.create({
  name: "outlineToken",
  inclusive: false,
  addAttributes: () => ({
    type: { default: "token", rendered: false },
    instance: { default: "", rendered: false },
    extension: { default: "", rendered: false },
    source: { default: "", rendered: false },
    label: { default: "", rendered: false },
    data: { default: null, rendered: false },
  }),
  // The visible source remains ordinary editable text; the mark carries opaque host identity.
  renderHTML: () => ["span", 0],
});

const HardBreak = Node.create({
  group: "inline",
  inline: true,
  name: "hardBreak",
  parseHTML: () => [{ tag: "br" }],
  renderHTML: () => ["br"],
  renderText: () => "\n",
  selectable: false,
});

const History = Extension.create({
  name: "outlineHistory",
  addProseMirrorPlugins: () => [history()],
  addKeyboardShortcuts() {
    return {
      "Mod-z": () => undo(this.editor.state, this.editor.view.dispatch),
      "Mod-Shift-z": () => redo(this.editor.state, this.editor.view.dispatch),
      "Mod-y": () => redo(this.editor.state, this.editor.view.dispatch),
    };
  },
});

export const outlineEditorDocument = [
  Document.extend({ content: "paragraph" }),
  Paragraph.extend({ content: "inline*" }),
  Text,
  HardBreak,
  Token,
  History,
];
