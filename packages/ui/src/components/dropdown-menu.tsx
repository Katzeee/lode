import { Menu } from "@base-ui/react/menu";
import type { IconName } from "@lode/design-system-catalog";

import { Button } from "./button.js";
import { Icon } from "./icon.js";

export type DropdownMenuItem = Readonly<{
  disabled?: boolean;
  icon?: IconName;
  label: string;
  onSelect: () => void;
  tone?: "default" | "destructive";
}>;

// Dropdown and context menus render identical items from identical data.
export const menuPopupClassName =
  "lode-overlay-popup min-w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none";

export function menuItemClassName(tone: DropdownMenuItem["tone"]): string {
  return tone === "destructive"
    ? "flex cursor-default items-center gap-2 rounded-sm px-2.5 py-2 text-label text-destructive outline-none data-disabled:opacity-50 data-highlighted:bg-destructive-subtle data-highlighted:text-destructive-strong"
    : "flex cursor-default items-center gap-2 rounded-sm px-2.5 py-2 text-label outline-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground";
}

export function DropdownMenu({ items, label }: Readonly<{ items: readonly DropdownMenuItem[]; label: string }>) {
  return (
    <Menu.Root>
      <Menu.Trigger render={<Button size="sm" variant="outline" />}>
        {label}
        <Icon name="chevron-down" size="sm" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" className="z-50 outline-none" sideOffset={8}>
          <Menu.Popup className={menuPopupClassName}>
            {items.map((item) => (
              <Menu.Item
                className={menuItemClassName(item.tone)}
                disabled={item.disabled}
                key={item.label}
                onClick={item.onSelect}
              >
                {item.icon === undefined ? null : <Icon name={item.icon} size="sm" />}
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
