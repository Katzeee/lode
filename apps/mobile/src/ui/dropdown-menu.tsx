import { useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '@lode/design-tokens';
import type { IconName } from '@lode/design-system-catalog';

import { Button } from './button';
import { Icon } from './icon';
import { useOverlayTransition } from './motion';
import { Text } from './text';
import { useColors, withAlpha } from './theme';

export type DropdownMenuItem = Readonly<{
  disabled?: boolean;
  icon?: IconName;
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'destructive';
}>;

export function DropdownMenu({
  items,
  label,
}: Readonly<{ items: readonly DropdownMenuItem[]; label: string }>) {
  const [open, setOpen] = useState(false);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const transition = useOverlayTransition(open);
  return (
    <>
      <Button onPress={() => setOpen(true)} size="sm" variant="outline">
        {label}
      </Button>
      <Modal
        animationType="none"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
        transparent
        visible={transition.mounted}
      >
        <View accessibilityViewIsModal style={styles.viewport}>
          <Pressable
            accessibilityLabel="Close menu"
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          >
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: withAlpha(colors.foreground, 0.36) },
                transition.backdropStyle,
              ]}
            />
          </Pressable>
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.popover,
                borderColor: colors.border,
                paddingBottom: insets.bottom + tokens.space.lg,
              },
              transition.popupStyle,
            ]}
          >
            <Text variant="label" weight="semibold">
              {label}
            </Text>
            <View style={styles.items}>
              {items.map(item => {
                const color =
                  item.tone === 'destructive'
                    ? 'destructive'
                    : 'popover-foreground';
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: item.disabled }}
                    disabled={item.disabled}
                    key={item.label}
                    onPress={() => {
                      item.onSelect();
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.item,
                      pressed && { backgroundColor: colors.accent },
                      item.disabled && { opacity: tokens.opacity.disabled },
                    ]}
                  >
                    {item.icon === undefined ? null : (
                      <Icon color={color} name={item.icon} />
                    )}
                    <Text color={color} weight="medium">
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: tokens.radius.xl,
    borderTopRightRadius: tokens.radius.xl,
    borderWidth: tokens.stroke.thin,
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.lg,
  },
  items: { gap: tokens.space['2xs'] },
  item: {
    alignItems: 'center',
    borderRadius: tokens.radius.sm,
    flexDirection: 'row',
    gap: tokens.space.sm,
    minHeight: tokens.control.height.comfortable,
    paddingHorizontal: tokens.space.sm,
  },
});
