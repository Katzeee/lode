import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { menuItemClassName, menuPopupClassName } from "../dropdown-menu.js";
import { cn } from "../cn.js";
import {
  activeSuggestionId,
  pageSuggestionId,
  revealSuggestionScrollTop,
  suggestionAction,
  type SuggestionKeyBinding,
  type SuggestionKeyboardEvent,
  type SuggestionRowGeometry,
} from "./suggestion-navigation.js";

export type SuggestionItem = Readonly<{
  id: string;
  label: string;
  description?: string;
  leading?: ReactNode;
}>;

type SuggestionOptions<Item extends SuggestionItem> = Readonly<{
  items: readonly Item[];
  sessionKey: string | null;
  keyBindings?: readonly SuggestionKeyBinding[];
  canAccept?: (item: Item) => boolean;
  onAccept: (item: Item) => void;
  onDismiss: () => void;
}>;

export function useSuggestionList<Item extends SuggestionItem>(options: SuggestionOptions<Item>) {
  const listId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<Readonly<{ sessionKey: string | null; id: string | null }>>({
    sessionKey: null,
    id: null,
  });
  const activeId = activeSuggestionId(options.items, selection.sessionKey === options.sessionKey ? selection.id : null);
  const current = useRef({ ...options, activeId });
  current.current = { ...options, activeId };
  const optionId = (id: string) => `${listId}-${encodeURIComponent(id)}`;

  useLayoutEffect(() => {
    if (selection.sessionKey !== options.sessionKey || selection.id !== activeId) {
      setSelection({ id: activeId, sessionKey: options.sessionKey });
    }
  }, [activeId, options.sessionKey, selection]);

  const rowGeometry = (): SuggestionRowGeometry[] => {
    const list = listRef.current;
    if (list === null) {
      return [];
    }
    const top = list.getBoundingClientRect().top + list.clientTop;
    return current.current.items.flatMap((item) => {
      const element = list.ownerDocument.getElementById(optionId(item.id));
      if (element === null || !list.contains(element)) {
        return [];
      }
      const bounds = element.getBoundingClientRect();
      return [{ id: item.id, top: bounds.top - top + list.scrollTop, height: bounds.height }];
    });
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    const row = rowGeometry().find((item) => item.id === activeId);
    if (list !== null && row !== undefined && options.sessionKey !== null) {
      // Only scroll the popup; native scrollIntoView may also move the surrounding document.
      list.scrollTop = revealSuggestionScrollTop(list.scrollTop, list.clientHeight, row);
    }
  }, [activeId, options.items, options.sessionKey]);

  const accept = (item: Item) => {
    const state = current.current;
    const latest = state.items.find((candidate) => candidate.id === item.id);
    if (state.sessionKey !== null && latest !== undefined && state.canAccept?.(latest) !== false) {
      state.onAccept(latest);
    }
  };
  const select = (id: string) => {
    current.current.activeId = id;
    setSelection({ id, sessionKey: current.current.sessionKey });
  };
  const handleKeyDown = (event: SuggestionKeyboardEvent): boolean => {
    const state = current.current;
    if (state.sessionKey === null) {
      return false;
    }
    const action = suggestionAction(event, state.keyBindings);
    if (action === null) {
      return false;
    }
    if (action === "dismiss") {
      state.onDismiss();
      return true;
    }
    const index = state.items.findIndex((item) => item.id === state.activeId);
    const item = state.items[index];
    if (item === undefined) {
      state.onDismiss();
      return false;
    }
    switch (action) {
      case "accept":
        accept(item);
        break;
      case "next":
      case "previous":
        select(state.items[(index + (action === "next" ? 1 : -1) + state.items.length) % state.items.length]!.id);
        break;
      case "first":
      case "last":
        select(state.items[action === "first" ? 0 : state.items.length - 1]!.id);
        break;
      case "nextPage":
      case "previousPage":
        select(
          pageSuggestionId(rowGeometry(), item.id, listRef.current?.clientHeight ?? 0, action === "nextPage" ? 1 : -1),
        );
        break;
    }
    return true;
  };
  return { activeId, accept, handleKeyDown, listId, listRef, optionId };
}

export type SuggestionListController<Item extends SuggestionItem> = ReturnType<typeof useSuggestionList<Item>>;

export function SuggestionList<Item extends SuggestionItem>({
  controller,
  emptyLabel,
  heading,
  items,
  label,
  panelRef,
  renderItem,
}: Readonly<{
  controller: SuggestionListController<Item>;
  emptyLabel: string;
  heading: string;
  items: readonly Item[];
  label: string;
  panelRef: RefObject<HTMLDivElement | null>;
  renderItem?: (item: Item, active: boolean) => ReactNode;
}>) {
  return createPortal(
    <div
      className={`${menuPopupClassName} fixed z-50 flex max-h-64 w-72 max-w-full flex-col`}
      onMouseDown={(event) => event.preventDefault()}
      ref={panelRef}
    >
      <div className="shrink-0 px-2.5 pb-1 pt-1.5 text-caption font-medium text-muted-foreground">{heading}</div>
      <div
        aria-label={label}
        className="min-h-0 overflow-y-auto"
        id={controller.listId}
        ref={controller.listRef}
        role="listbox"
      >
        {items.length === 0 ? (
          <div className="px-2.5 py-2 text-label text-muted-foreground" role="status">
            {emptyLabel}
          </div>
        ) : (
          items.map((item) => {
            const active = item.id === controller.activeId;
            return (
              <button
                aria-selected={active}
                className={cn(menuItemClassName(undefined), "w-full items-start text-left")}
                data-highlighted={active ? "" : undefined}
                id={controller.optionId(item.id)}
                key={item.id}
                onClick={() => controller.accept(item)}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                tabIndex={-1}
                type="button"
              >
                {renderItem?.(item, active) ?? (
                  <>
                    {item.leading === undefined ? null : (
                      <span
                        aria-hidden
                        className="mt-0.5 grid size-4 shrink-0 place-items-center text-muted-foreground"
                        data-ui="suggestion-leading"
                      >
                        {item.leading}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col items-start">
                      <span className="font-medium">{item.label}</span>
                      {item.description === undefined ? null : (
                        <span className="max-w-full truncate text-caption text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                    </span>
                  </>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  );
}
