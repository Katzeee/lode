import { useSyncExternalStore, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '@lode/design-tokens';
import type { AlertTone } from '@lode/design-system-catalog';

import { Button } from './button';
import { Icon } from './icon';
import { useOverlayTransition } from './motion';
import { Text } from './text';
import { useColors, type ThemeColors } from './theme';

export type ToastOptions = Readonly<{
  action?: Readonly<{ label: string; onPress: () => void }>;
  description?: string;
  title: string;
  tone?: AlertTone;
}>;

type ToastEntry = ToastOptions & Readonly<{ id: string; open: boolean }>;

let sequence = 0;
let entries: readonly ToastEntry[] = [];
const listeners = new Set<() => void>();

export function toast(options: ToastOptions): string {
  const id = `toast-${Date.now()}-${sequence++}`;
  entries = [...entries, { ...options, id, open: true }];
  emit();
  setTimeout(() => dismiss(id), 5000);
  return id;
}

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const insets = useSafeAreaInsets();
  return (
    <>
      {children}
      <View
        pointerEvents="box-none"
        style={[styles.viewport, { bottom: insets.bottom + tokens.space.lg }]}
      >
        {toasts.map(item => (
          <ToastItem item={item} key={item.id} />
        ))}
      </View>
    </>
  );
}

function ToastItem({ item }: Readonly<{ item: ToastEntry }>) {
  const colors = useColors();
  const transition = useOverlayTransition(item.open);
  if (!transition.mounted) {
    return null;
  }
  return (
    <Animated.View
      accessibilityLiveRegion={
        item.tone === 'destructive' ? 'assertive' : 'polite'
      }
      style={[
        styles.toast,
        {
          backgroundColor: colors.popover,
          borderColor: colors.border,
          shadowColor: colors.foreground,
        },
        transition.popupStyle,
      ]}
    >
      <View style={[styles.tone, toneStyle(item.tone, colors)]} />
      <View style={styles.copy}>
        <Text variant="label" weight="semibold">
          {item.title}
        </Text>
        {item.description === undefined ? null : (
          <Text color="muted-foreground" variant="caption">
            {item.description}
          </Text>
        )}
        {item.action === undefined ? null : (
          <View style={styles.action}>
            <Button
              onPress={() => {
                item.action?.onPress();
                dismiss(item.id);
              }}
              size="sm"
              variant="outline"
            >
              {item.action.label}
            </Button>
          </View>
        )}
      </View>
      <Pressable
        accessibilityLabel="Dismiss notification"
        accessibilityRole="button"
        hitSlop={tokens.space.sm}
        onPress={() => dismiss(item.id)}
        style={styles.close}
      >
        <Icon color="muted-foreground" name="x" size="sm" />
      </Pressable>
    </Animated.View>
  );
}

function dismiss(id: string): void {
  const item = entries.find(candidate => candidate.id === id);
  if (item === undefined || !item.open) {
    return;
  }
  entries = entries.map(candidate =>
    candidate.id === id ? { ...candidate, open: false } : candidate,
  );
  emit();
  setTimeout(() => {
    entries = entries.filter(candidate => candidate.id !== id);
    emit();
  }, tokens.motion.duration.panel);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): readonly ToastEntry[] {
  return entries;
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function toneStyle(
  tone: AlertTone | undefined,
  colors: ThemeColors,
): ViewStyle {
  switch (tone) {
    case 'destructive': {
      return { backgroundColor: colors.destructive };
    }
    case 'warning': {
      return { backgroundColor: colors.warning };
    }
    case 'success': {
      return { backgroundColor: colors.success };
    }
    case 'neutral':
    case undefined: {
      return { backgroundColor: colors.primary };
    }
  }
}

const styles = StyleSheet.create({
  viewport: {
    gap: tokens.space.xs,
    left: tokens.space.lg,
    position: 'absolute',
    right: tokens.space.lg,
  },
  toast: {
    borderRadius: tokens.radius.md,
    borderWidth: tokens.stroke.thin,
    elevation: 8,
    flexDirection: 'row',
    gap: tokens.space.sm,
    overflow: 'hidden',
    padding: tokens.space.md,
    shadowOffset: { height: tokens.space.xs, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: tokens.radius.md,
  },
  tone: { borderRadius: tokens.radius.full, width: tokens.stroke.focus },
  copy: { flex: 1, gap: tokens.space['2xs'] },
  action: { alignItems: 'flex-start', marginTop: tokens.space.xs },
  close: { padding: tokens.space['2xs'] },
});
