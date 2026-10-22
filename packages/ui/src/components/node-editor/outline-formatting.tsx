import { surroundOutlineSelection, type OutlineInlineExtension } from "./outline-inline-extension.js";

function paired(delimiter: string, literal = false): OutlineInlineExtension["match"] {
  return (source) => {
    if (!source.startsWith(delimiter)) {
      return null;
    }
    let end = source.indexOf(delimiter, delimiter.length);
    while (end >= 0 && source[end - 1] === "\\") {
      end = source.indexOf(delimiter, end + delimiter.length);
    }
    return end > delimiter.length
      ? { contentFrom: delimiter.length, contentTo: end, length: end + delimiter.length, literal }
      : null;
  };
}

/** The host explicitly installs these extensions alongside its own inline vocabulary. */
export const outlineFormatting: readonly OutlineInlineExtension[] = [
  {
    id: "escape",
    match: (source) =>
      /^\\[^\p{L}\p{N}\s]/u.test(source) ? { contentFrom: 1, contentTo: 2, length: 2, literal: true } : null,
    render: ({ children }) => children,
  },
  {
    id: "bold",
    match: paired("**"),
    render: ({ children }) => <strong>{children}</strong>,
    shortcut: { key: "b", apply: (content, selection) => surroundOutlineSelection(content, selection, "**") },
  },
  {
    id: "italic",
    match: paired("__"),
    render: ({ children }) => <em>{children}</em>,
    shortcut: { key: "i", apply: (content, selection) => surroundOutlineSelection(content, selection, "__") },
  },
  {
    id: "code",
    match: paired("`", true),
    render: ({ children }) => <code>{children}</code>,
    shortcut: { key: "e", apply: (content, selection) => surroundOutlineSelection(content, selection, "`") },
  },
];
