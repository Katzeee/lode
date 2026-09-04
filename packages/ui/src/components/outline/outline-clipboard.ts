import type { ClipboardEvent } from "react";
import { contentLength, contentToSource, type OutlineInline } from "./outline-content.js";
import type { OutlineClipboardItem, OutlineTreeEditing } from "./outline-tree-edit-contract.js";
import type { useOutlineEdit } from "./outline-tree-edit.js";
import type { OutlineRowViewModel } from "./outline-tree-view-model.js";

const MIME = "application/x-lode-outline";
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
function isInline(value: unknown): value is OutlineInline {
  const item = record(value);
  return item?.type === "text"
    ? typeof item.text === "string"
    : item?.type === "token" &&
        typeof item.extension === "string" &&
        typeof item.source === "string" &&
        typeof item.label === "string";
}
function isItem(value: unknown): value is OutlineClipboardItem {
  const item = record(value);
  return (
    item !== null &&
    Array.isArray(item.content) &&
    item.content.every(isInline) &&
    Array.isArray(item.children) &&
    item.children.every(isItem)
  );
}
export function parseOutlineClipboard(data: Pick<DataTransfer, "getData">): readonly OutlineClipboardItem[] | null {
  const encoded = data.getData(MIME);
  if (encoded.length > 0) {
    try {
      const value: unknown = JSON.parse(encoded);
      if (Array.isArray(value) && value.every(isItem)) {
        return value;
      }
    } catch {
      /* Other applications can supply an unrelated custom payload. */
    }
  }
  const text = data.getData("text/plain");
  if (!/[\r\n]/u.test(text)) {
    return null;
  }
  type Item = { content: OutlineInline[]; children: Item[] };
  const roots: Item[] = [];
  const stack: Item[] = [];
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  for (const line of lines) {
    const indentation = /^[\t ]*/u.exec(line)?.[0] ?? "";
    const depth = Math.min(stack.length, indentation.replace(/ {2}/gu, "\t").replace(/ /gu, "").length);
    const item: Item = { content: [{ type: "text", text: line.slice(indentation.length) }], children: [] };
    (depth === 0 ? roots : stack[depth - 1]!.children).push(item);
    stack[depth] = item;
    stack.length = depth + 1;
  }
  return roots;
}
export function writeOutlineClipboard(data: Pick<DataTransfer, "setData">, items: readonly OutlineClipboardItem[]) {
  const lines: string[] = [];
  const visit = (item: OutlineClipboardItem, depth: number) => {
    lines.push("\t".repeat(depth) + contentToSource(item.content));
    item.children.forEach((child) => visit(child, depth + 1));
  };
  items.forEach((item) => visit(item, 0));
  data.setData(MIME, JSON.stringify(items));
  data.setData("text/plain", lines.join("\n"));
}

type ClipboardContext = Readonly<{
  rows: readonly OutlineRowViewModel[];
  roots: readonly string[];
  editing?: OutlineTreeEditing;
  edit: ReturnType<typeof useOutlineEdit>;
  cursorKey: string | null;
  clear: () => void;
  remove: (keys: readonly string[]) => void;
}>;

export function outlineClipboard(context: ClipboardContext) {
  const copy = (event: ClipboardEvent, cut = false) => {
    if (context.roots.length === 0) {
      return;
    }
    const item = (row: OutlineRowViewModel["item"]): OutlineClipboardItem => ({
      content: row.content,
      children: (row.children ?? []).map(item),
    });
    const items =
      context.editing?.onCopy?.(context.roots) ??
      context.roots.flatMap((key) => {
        const row = context.rows.find((row) => row.key === key);
        return row === undefined ? [] : [item(row.item)];
      });
    event.preventDefault();
    event.stopPropagation();
    writeOutlineClipboard(event.clipboardData, items);
    if (cut) {
      context.remove(context.roots);
    }
  };
  const paste = (event: ClipboardEvent) => {
    if (!(event.target instanceof Element) || event.target.closest("input, textarea, button")) {
      return;
    }
    const position = context.edit.getPosition();
    const row = context.rows.find((row) => row.key === (context.edit.activeKey ?? context.cursorKey));
    const text = event.clipboardData.getData("text/plain");
    const items =
      parseOutlineClipboard(event.clipboardData) ??
      (row === undefined && text.length > 0 ? [{ content: [{ type: "text" as const, text }], children: [] }] : null);
    context.clear();
    if (items === null || items.length === 0 || context.editing?.onPaste === undefined) {
      return;
    }
    const from = row === undefined ? 0 : position?.key === row.key ? position.caret : contentLength(row.item.content);
    const to = row !== undefined && position?.key === row.key ? (position.selectionEnd ?? from) : from;
    event.preventDefault();
    event.stopPropagation();
    context.editing.history?.checkpoint(position, "operation");
    context.edit.commit();
    const result = context.editing.onPaste(row?.key ?? null, {
      items,
      selection: { from, to },
      placement: row?.expanded === true && row.hasChildren ? "child" : "after",
      replaceEmpty: row !== undefined && contentLength(row.item.content) === 0 && !row.hasChildren,
    });
    if (result !== null) {
      context.edit.restore(result);
    }
  };
  return {
    onCopyCapture: (event: ClipboardEvent) => copy(event),
    onCutCapture: (event: ClipboardEvent) => copy(event, true),
    onPasteCapture: paste,
  };
}
