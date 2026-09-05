import { useEffect, useRef, type MouseEvent, type RefObject } from "react";
import { flushSync } from "react-dom";

import { caretOffsetAtPoint } from "./outline-caret.js";
import { contentLength, contentToSource } from "./outline-content.js";
import {
  emptyOutlineSelection,
  extendOutlineSelection,
  selectOutlineRow,
  toggleOutlineRow,
  type OutlineSelection,
} from "./outline-selection.js";
import type { useOutlineEdit } from "./outline-tree-edit.js";
import type { OutlineRowViewModel } from "./outline-tree-view-model.js";

type PointerOptions = Readonly<{
  containerRef: RefObject<HTMLDivElement | null>;
  rows: readonly OutlineRowViewModel[];
  edit: ReturnType<typeof useOutlineEdit>;
  selection: OutlineSelection;
  select: (selection: OutlineSelection) => void;
  cursor: (key: string) => void;
}>;

export function useOutlinePointer(options: PointerOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  useEffect(() => {
    const outside = (event: globalThis.MouseEvent) => {
      const { containerRef, select } = optionsRef.current;
      const owner =
        event.target instanceof Element
          ? event.target.closest("[data-outline-owner]")?.getAttribute("data-outline-owner")
          : null;
      if (owner === containerRef.current?.id) {
        return;
      }
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        select(emptyOutlineSelection);
      }
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, []);

  const track = (row: OutlineRowViewModel, event: MouseEvent, caret: number, native: boolean) => {
    cleanupRef.current?.();
    const move = (pointer: globalThis.MouseEvent) => {
      if (Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY) < 3) {
        return;
      }
      const { rows, edit, select, containerRef } = optionsRef.current;
      const element = document
        .elementFromPoint(pointer.clientX, pointer.clientY)
        ?.closest<HTMLElement>('[data-ui="outline-row"]');
      if (element === null || element === undefined || !containerRef.current?.contains(element)) {
        return;
      }
      const target = rows.find((candidate) => candidate.key === element.dataset.itemKey);
      if (target === undefined) {
        return;
      }
      if (target.key !== row.key) {
        pointer.preventDefault();
        select(extendOutlineSelection(rows, selectOutlineRow(row.key), target.key));
        window.getSelection()?.removeAllRanges();
      } else if (!native) {
        const content = element.querySelector<HTMLElement>('[data-ui="outline-editor"]');
        if (content !== null) {
          const end = caretOffsetAtPoint(content, pointer.clientX, pointer.clientY);
          select(emptyOutlineSelection);
          edit.selectText(Math.min(caret, end), Math.max(caret, end));
        }
      }
    };
    const end = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      cleanupRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    cleanupRef.current = end;
  };

  return (row: OutlineRowViewModel, event: MouseEvent) => {
    if (
      event.button !== 0 ||
      !(event.target instanceof Element) ||
      event.target.closest('button, a, input, select, textarea, [data-ui="outline-bullet"], [role="checkbox"]')
    ) {
      return;
    }
    const { edit, selection, select, containerRef, rows, cursor } = optionsRef.current;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      select(toggleOutlineRow(rows, selection, row.key));
      if (edit.activeKey === null) {
        cursor(row.key);
        containerRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    const position = edit.getPosition();
    if (event.shiftKey && selection.keys.size > 0) {
      event.preventDefault();
      select(extendOutlineSelection(rows, selection, row.key));
      return;
    }
    if (event.shiftKey && position !== null && edit.activeKey !== null) {
      event.preventDefault();
      const active = rows.find((candidate) => candidate.key === edit.activeKey);
      if (active !== undefined) {
        const source = event.currentTarget.querySelector<HTMLElement>('[data-ui="outline-editor"]');
        const end =
          row.key === active.key && source !== null
            ? caretOffsetAtPoint(source, event.clientX, event.clientY)
            : rows.indexOf(row) > rows.indexOf(active)
              ? contentLength(active.item.content)
              : 0;
        edit.selectText(Math.min(position.caret, end), Math.max(position.caret, end));
      }
      return;
    }
    select(emptyOutlineSelection);
    cursor(row.key);
    if (row.item.editable === false) {
      edit.commitAndExit();
      containerRef.current?.focus({ preventScroll: true });
      return;
    }
    if (row.item.activation === "object" && edit.activeKey !== row.key) {
      event.preventDefault();
      if (event.detail >= 2) {
        flushSync(() => edit.startAtCaret(row, contentLength(row.item.content)));
      } else {
        edit.commitAndExit();
        containerRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    const native = event.target.closest('[data-ui="outline-editor"]') !== null;
    if (event.detail >= 2) {
      event.preventDefault();
      const source = contentToSource(row.item.content);
      const element = event.currentTarget.querySelector<HTMLElement>(
        '[data-ui="outline-editor"], [data-ui="outline-inline-content"]',
      );
      const offset = element === null ? 0 : caretOffsetAtPoint(element, event.clientX, event.clientY);
      const word = [...source.matchAll(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]+/gu)].find(
        (match) => offset >= match.index && offset < match.index + match[0].length,
      );
      const from = event.detail === 2 ? (word?.index ?? offset) : 0;
      const to = event.detail === 2 ? from + (word?.[0].length ?? 0) : source.length;
      flushSync(() => edit.startAtCaret(row, from, to));
      containerRef.current?.querySelector<HTMLElement>('[data-ui="outline-editor"]')?.focus({ preventScroll: true });
      return;
    }
    if (native) {
      track(row, event, position?.caret ?? 0, true);
      return;
    }
    event.preventDefault();
    const content = event.currentTarget.querySelector<HTMLElement>(
      '[data-ui="outline-inline-content"], [data-ui="outline-editor"]',
    );
    const caret =
      content === null ? contentLength(row.item.content) : caretOffsetAtPoint(content, event.clientX, event.clientY);
    flushSync(() => edit.startAtCaret(row, caret));
    containerRef.current?.querySelector<HTMLElement>('[data-ui="outline-editor"]')?.focus({ preventScroll: true });
    track(row, event, caret, false);
  };
}
