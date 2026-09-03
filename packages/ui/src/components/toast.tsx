import { Toast as BaseToast } from "@base-ui/react/toast";
import type { AlertTone, IconName } from "@lode/design-system-catalog";
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
        <BaseToast.Viewport className="pointer-events-none fixed inset-x-4 top-4 z-50 flex flex-col items-end gap-2 outline-none">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

const toneMarks: Readonly<Record<Exclude<AlertTone, "neutral">, Readonly<{ bubble: string; icon: IconName }>>> = {
  success: { bubble: "bg-success-subtle text-success-strong", icon: "check" },
  warning: { bubble: "bg-warning-subtle text-warning-strong", icon: "circle-alert" },
  destructive: { bubble: "bg-destructive-subtle text-destructive-strong", icon: "circle-alert" },
};

function ToastList() {
  const { toasts } = BaseToast.useToastManager<ToastData>();
  return toasts.map((item) => {
    const data = item.data ?? { tone: "neutral" };
    const mark = data.tone === "neutral" ? undefined : toneMarks[data.tone];
    return (
      <BaseToast.Root
        className="lode-overlay-popup pointer-events-auto w-96 max-w-full rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg"
        data-ui="toast"
        key={item.id}
        swipeDirection={["up", "right"]}
        toast={item}
      >
        <BaseToast.Content className="flex items-start gap-3" data-ui="toast-content">
          {mark === undefined ? null : (
            <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full ${mark.bubble}`}>
              <Icon name={mark.icon} size="sm" />
            </span>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <BaseToast.Title className="text-label font-semibold" />
            <BaseToast.Description className="mt-0.5 text-caption text-muted-foreground" />
            {data.action === undefined ? null : (
              <BaseToast.Action className="mt-2.5" render={<Button size="sm" variant="outline" />}>
                {data.action.label}
              </BaseToast.Action>
            )}
          </div>
          <BaseToast.Close
            aria-label="Dismiss notification"
            data-ui="toast-close"
            render={<Button className="-mt-1.5 -mr-1.5 size-7 shrink-0" size="icon" variant="ghost" />}
          >
            <Icon name="x" size="sm" />
          </BaseToast.Close>
        </BaseToast.Content>
      </BaseToast.Root>
    );
  });
}
