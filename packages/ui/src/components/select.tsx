import { Select as BaseSelect } from "@base-ui/react/select";

import { cn } from "./cn.js";
import { Icon } from "./icon.js";

export type SelectOption = Readonly<{
  disabled?: boolean;
  label: string;
  value: string;
}>;

export function Select({
  className,
  defaultValue,
  disabled,
  name,
  onValueChange,
  options,
  placeholder = "Select…",
  value,
}: Readonly<{
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  name?: string;
  onValueChange?: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  value?: string;
}>) {
  return (
    <BaseSelect.Root
      defaultValue={defaultValue}
      disabled={disabled}
      items={options.map((option) => ({ label: option.label, value: option.value }))}
      name={name}
      onValueChange={onValueChange === undefined ? undefined : (next) => onValueChange(next as string)}
      value={value}
    >
      <BaseSelect.Trigger
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-sm border border-input bg-card px-3 text-body text-foreground shadow-xs outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/25 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-placeholder:text-muted-foreground",
          className,
        )}
      >
        <BaseSelect.Value className="truncate" placeholder={placeholder} />
        <BaseSelect.Icon className="shrink-0 text-muted-foreground">
          <Icon name="chevron-down" size="sm" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        {/* Drop below the trigger like every other anchored popup; the
            macOS-style overlay default would cover the control it came from. */}
        <BaseSelect.Positioner alignItemWithTrigger={false} className="z-50 outline-none" sideOffset={6}>
          <BaseSelect.Popup
            className="lode-overlay-popup max-h-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"
            style={{ minWidth: "var(--anchor-width)" }}
          >
            {options.map((option) => (
              <BaseSelect.Item
                className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-sm px-2.5 py-2 text-label outline-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                disabled={option.disabled}
                key={option.value}
                value={option.value}
              >
                <BaseSelect.ItemIndicator className="col-start-1">
                  <Icon name="check" size="sm" />
                </BaseSelect.ItemIndicator>
                <BaseSelect.ItemText className="col-start-2 truncate">{option.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
