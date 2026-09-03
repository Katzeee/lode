import { Combobox as BaseCombobox } from "@base-ui/react/combobox";

import { cn } from "./cn.js";
import { Icon } from "./icon.js";
import { inputClassName } from "./input.js";

export type ComboboxOption = Readonly<{
  label: string;
  value: string;
}>;

export function Combobox({
  className,
  defaultValue,
  disabled,
  name,
  onValueChange,
  options,
  placeholder,
}: Readonly<{
  className?: string;
  defaultValue?: ComboboxOption;
  disabled?: boolean;
  name?: string;
  onValueChange?: (value: ComboboxOption | null) => void;
  options: readonly ComboboxOption[];
  placeholder?: string;
}>) {
  return (
    <BaseCombobox.Root
      defaultValue={defaultValue}
      disabled={disabled}
      items={options}
      itemToStringLabel={(option: ComboboxOption) => option.label}
      itemToStringValue={(option: ComboboxOption) => option.value}
      name={name}
      onValueChange={onValueChange}
    >
      <div className="lode-input-hit-area relative flex w-full items-center" data-ui="input-hit-area">
        <BaseCombobox.Input className={cn(inputClassName, "pr-9", className)} placeholder={placeholder} />
        <BaseCombobox.Trigger
          aria-label="Open options"
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50"
          tabIndex={-1}
        >
          <Icon name="chevron-down" size="sm" />
        </BaseCombobox.Trigger>
      </div>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner className="z-50 outline-none" sideOffset={6}>
          <BaseCombobox.Popup
            className="lode-overlay-popup max-h-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"
            style={{ minWidth: "var(--anchor-width)" }}
          >
            {/* The element stays mounted while results exist; only its
                no-match state may occupy space. */}
            <BaseCombobox.Empty className="px-2.5 py-2 text-label text-muted-foreground empty:hidden">
              No matches found.
            </BaseCombobox.Empty>
            <BaseCombobox.List>
              {(option: ComboboxOption) => (
                <BaseCombobox.Item
                  className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-sm px-2.5 py-2 text-label outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  key={option.value}
                  value={option}
                >
                  <BaseCombobox.ItemIndicator className="col-start-1">
                    <Icon name="check" size="sm" />
                  </BaseCombobox.ItemIndicator>
                  <span className="col-start-2 truncate">{option.label}</span>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
