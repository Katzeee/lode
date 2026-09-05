import type { ReactNode } from "react";

export type OutlineChildrenLayout = "beside" | "indented";

export type OutlineContentStyle = Readonly<{
  decoration?: "line-through";
  tone?: "default" | "muted";
  weight?: "medium" | "normal";
}>;

export type OutlinePresentationRowState = Readonly<{
  depth: number;
  expanded: boolean;
  expandable: boolean;
  hasChildren: boolean;
  selected: boolean;
}>;

export type OutlineBulletPresentation<Action> = Readonly<{
  accessibilityLabel?: string;
  action?: Action;
  content: ReactNode;
}>;

export type OutlineRowPresentation<Action> = Readonly<{
  bullet: OutlineBulletPresentation<Action>;
  childrenLayout?: OutlineChildrenLayout;
  contentStyle?: OutlineContentStyle;
  details?: ReactNode;
  leading?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  trailing?: ReactNode;
}>;

export type OutlinePresentationContext<Action> = Readonly<{
  executeCommand: (id: string) => boolean;
  canExecuteCommand: (id: string) => boolean;
  canDispatch: boolean;
  dispatch: (action: Action) => void;
  itemKey: string;
  itemLabel: string;
  state: OutlinePresentationRowState;
}>;

export type OutlinePresentationRegistry<Presentation, Action> = Readonly<{
  resolve: (presentation: Presentation, context: OutlinePresentationContext<Action>) => OutlineRowPresentation<Action>;
}>;

export type ResolvedOutlineBulletPresentation = Readonly<{
  accessibilityLabel?: string;
  content: ReactNode;
  onActivate?: () => void;
}>;

export type ResolvedOutlineRowPresentation = Omit<OutlineRowPresentation<never>, "bullet"> &
  Readonly<{ bullet: ResolvedOutlineBulletPresentation }>;

export function resolveOutlinePresentation<Presentation, Action>(
  registry: OutlinePresentationRegistry<Presentation, Action>,
  presentation: Presentation,
  itemKey: string,
  itemLabel: string,
  state: OutlinePresentationRowState,
  onAction?: (key: string, action: Action) => void,
  commands?: Readonly<{ executeCommand: (id: string) => boolean; canExecuteCommand: (id: string) => boolean }>,
): ResolvedOutlineRowPresentation {
  const resolved = registry.resolve(presentation, {
    executeCommand: commands?.executeCommand ?? (() => false),
    canExecuteCommand: commands?.canExecuteCommand ?? (() => false),
    canDispatch: onAction !== undefined,
    dispatch: (action) => onAction?.(itemKey, action),
    itemKey,
    itemLabel,
    state,
  });
  const action = resolved.bullet.action;
  return {
    ...resolved,
    bullet: {
      accessibilityLabel: resolved.bullet.accessibilityLabel,
      content: resolved.bullet.content,
      onActivate: action === undefined || onAction === undefined ? undefined : () => onAction(itemKey, action),
    },
  };
}
