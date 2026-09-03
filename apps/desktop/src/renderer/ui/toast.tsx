import { Toast as BaseToast } from "@base-ui/react/toast";
import type { AlertTone } from "@lode/design-system-catalog";
import type { ReactNode } from "react";

import { Button } from "./button.js";
import { Icon } from "./icon.js";

export type ToastOptions = Readonly<{
  action?: Readonly<{ label: string; onPress: () => void }>;
  description?: string;
  title: string;
  tone?: AlertTone;
}>;

type ToastData = Readonly<{
  action?: ToastOptions["action"];
  tone: AlertTone;
}>;

const manager = BaseToast.createToastManager<ToastData>();

export function toast({ action, description, title, tone = "neutral" }: ToastOptions): string {
  return manager.add({
    actionProps: action === undefined ? undefined : { onClick: action.onPress },
    data: { action, tone },
    description,
    priority: tone === "destructive" ? "high" : "low",
    title,
    type: tone,
  });
}

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <BaseToast.Provider limit={4} toastManager={manager}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 outline-none sm:left-auto sm:w-96">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager<ToastData>();
  return toasts.map((item) => {
    const data = item.data ?? { tone: "neutral" };
    return (
      <BaseToast.Root
        className="lode-overlay-popup pointer-events-auto relative rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg"
        key={item.id}
        swipeDirection={["down", "right"]}
        toast={item}
      >
        <div
          aria-hidden
          className={
            data.tone === "destructive"
              ? "absolute inset-y-3 left-0 w-1 rounded-full bg-destructive"
              : data.tone === "warning"
                ? "absolute inset-y-3 left-0 w-1 rounded-full bg-warning"
                : data.tone === "success"
                  ? "absolute inset-y-3 left-0 w-1 rounded-full bg-success"
                  : "absolute inset-y-3 left-0 w-1 rounded-full bg-primary"
          }
        />
        <BaseToast.Content className="flex items-start gap-3 pl-1">
          <div className="min-w-0 flex-1">
            <BaseToast.Title className="text-label font-semibold" />
            <BaseToast.Description className="mt-0.5 text-caption text-muted-foreground" />
            {data.action === undefined ? null : (
              <BaseToast.Action className="mt-3" render={<Button size="sm" variant="outline" />}>
                {data.action.label}
              </BaseToast.Action>
            )}
          </div>
          <BaseToast.Close aria-label="Dismiss notification" render={<Button size="icon" variant="ghost" />}>
            <Icon name="x" size="sm" />
          </BaseToast.Close>
        </BaseToast.Content>
      </BaseToast.Root>
    );
  });
}
