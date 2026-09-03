import type { RefObject } from "react";
import { createPortal } from "react-dom";

import { menuItemClassName, menuPopupClassName } from "./dropdown-menu.js";
import type { OutlineCompletionItem, OutlineEditorCompletionProvider } from "./outline-tree-edit-contract.js";

export type OutlinePickerState = Readonly<{
  activeIndex: number;
  from: number;
  provider: OutlineEditorCompletionProvider;
  query: string;
  results: readonly OutlineCompletionItem[];
  to: number;
}>;

export function OutlineInlinePicker({
  elementRef,
  onSelect,
  picker,
}: Readonly<{
  elementRef: RefObject<HTMLDivElement | null>;
  onSelect: (item: OutlineCompletionItem) => void;
  picker: OutlinePickerState | null;
}>) {
  if (picker === null) {
    return null;
  }
  return createPortal(
    <div
      aria-label={picker.provider.ariaLabel}
      className={`${menuPopupClassName} fixed z-50 max-h-64 w-72 max-w-full overflow-y-auto`}
      onMouseDown={(event) => event.preventDefault()}
      ref={elementRef}
      role="listbox"
    >
      <div className="px-2.5 pb-1 pt-1.5 text-caption font-medium text-muted-foreground">{picker.provider.heading}</div>
      {picker.results.length === 0 ? (
        <div className="px-2.5 py-2 text-label text-muted-foreground">{picker.provider.emptyLabel}</div>
      ) : (
        picker.results.map((item, index) => (
          <PickerButton
            active={index === picker.activeIndex}
            description={item.description}
            key={item.id}
            label={item.label}
            onSelect={() => onSelect(item)}
          />
        ))
      )}
    </div>,
    document.body,
    "outline-inline-picker",
  );
}

function PickerButton({
  active,
  description,
  label,
  onSelect,
}: Readonly<{ active: boolean; description?: string; label: string; onSelect: () => void }>) {
  return (
    <button
      aria-selected={active}
      className={`${menuItemClassName(undefined)} w-full`}
      data-highlighted={active ? "" : undefined}
      onClick={onSelect}
      onMouseDown={(event) => event.preventDefault()}
      role="option"
      tabIndex={-1}
      type="button"
    >
      <span className="flex min-w-0 flex-col items-start">
        <span className="font-medium">{label}</span>
        {description === undefined ? null : (
          <span className="truncate text-caption text-muted-foreground">{description}</span>
        )}
      </span>
    </button>
  );
}
