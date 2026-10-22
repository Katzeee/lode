import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ButtonVariant } from "@lode/design-system-catalog";
import type { ReactNode } from "react";

import { Button } from "./button.js";

export type DialogAction = Readonly<{
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
}>;

export function Dialog({
  actions = [],
  children,
  description,
  onOpenChange,
  open,
  title,
}: Readonly<{
  actions?: readonly DialogAction[];
  children?: ReactNode;
  description?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}>) {
  return (
    <BaseDialog.Root onOpenChange={onOpenChange} open={open}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="lode-overlay-backdrop fixed inset-0 min-h-dvh bg-foreground/35" />
        <BaseDialog.Viewport className="fixed inset-0 grid min-h-dvh place-items-center overflow-y-auto p-4">
          <BaseDialog.Popup className="lode-overlay-popup w-full max-w-120 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg outline-none">
            <BaseDialog.Title className="text-title-small font-semibold tracking-tight">{title}</BaseDialog.Title>
            {description === undefined ? null : (
              <BaseDialog.Description className="mt-1 text-body text-muted-foreground">
                {description}
              </BaseDialog.Description>
            )}
            {children === undefined ? null : <div className="mt-5">{children}</div>}
            {actions.length === 0 ? null : (
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                {actions.map((action) => (
                  <BaseDialog.Close
                    key={action.label}
                    render={
                      <Button onClick={action.onPress} size="sm" variant={action.variant ?? "secondary"}>
                        {action.label}
                      </Button>
                    }
                  />
                ))}
              </div>
            )}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export function AlertDialog({
  cancelLabel = "Cancel",
  confirmLabel,
  description,
  onConfirm,
  onOpenChange,
  open,
  title,
}: Readonly<{
  cancelLabel?: string;
  confirmLabel: string;
  description: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}>) {
  return (
    <BaseAlertDialog.Root onOpenChange={onOpenChange} open={open}>
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop className="lode-overlay-backdrop fixed inset-0 min-h-dvh bg-foreground/35" />
        <BaseAlertDialog.Viewport className="fixed inset-0 grid min-h-dvh place-items-center overflow-y-auto p-4">
          <BaseAlertDialog.Popup className="lode-overlay-popup w-full max-w-120 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg outline-none">
            <BaseAlertDialog.Title className="text-title-small font-semibold tracking-tight">
              {title}
            </BaseAlertDialog.Title>
            <BaseAlertDialog.Description className="mt-1 text-body text-muted-foreground">
              {description}
            </BaseAlertDialog.Description>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <BaseAlertDialog.Close
                render={
                  <Button size="sm" variant="secondary">
                    {cancelLabel}
                  </Button>
                }
              />
              <BaseAlertDialog.Close
                render={
                  <Button onClick={onConfirm} size="sm" variant="destructive">
                    {confirmLabel}
                  </Button>
                }
              />
            </div>
          </BaseAlertDialog.Popup>
        </BaseAlertDialog.Viewport>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}
