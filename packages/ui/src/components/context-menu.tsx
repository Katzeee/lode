import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import type { ReactNode } from "react";

import { menuItemClassName, menuPopupClassName, type DropdownMenuItem } from "./dropdown-menu.js";
import { Icon } from "./icon.js";

export function ContextMenu({
  children,
  items,
}: Readonly<{
  children: ReactNode;
  items: readonly DropdownMenuItem[];
}>) {
  return (
    <BaseContextMenu.Root>
      <BaseContextMenu.Trigger className="block min-w-0">{children}</BaseContextMenu.Trigger>
      <BaseContextMenu.Portal>
        <BaseContextMenu.Positioner className="z-50 outline-none">
          <BaseContextMenu.Popup className={menuPopupClassName}>
            {items.map((item) => (
              <BaseContextMenu.Item
                className={menuItemClassName(item.tone)}
                disabled={item.disabled}
                key={item.label}
                onClick={item.onSelect}
              >
                {item.icon === undefined ? null : <Icon name={item.icon} size="sm" />}
                {item.label}
              </BaseContextMenu.Item>
            ))}
          </BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  );
}
