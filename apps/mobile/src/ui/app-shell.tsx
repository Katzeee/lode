import { tokens } from '@lode/design-tokens';
import type { IconName } from '@lode/design-system-catalog';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Icon } from './icon';
import { Text } from './text';
import { useColors } from './theme';

export type AppShellItem = Readonly<{
  icon: IconName;
  id: string;
  label: string;
}>;

export function AppShell({
  activeItemId,
  brand = 'Lode',
  children,
  items,
  onNavigate,
}: Readonly<{
  activeItemId: string;
  brand?: string;
  children: ReactNode;
  items: readonly AppShellItem[];
  onNavigate: (id: string) => void;
}>) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const expanded = width >= tokens.layout.breakpoint.expanded;
  const medium = width >= tokens.layout.breakpoint.medium;

  if (!medium) {
    return (
      <View style={[styles.compact, { backgroundColor: colors.background }]}>
        <View style={styles.content}>{children}</View>
        <View
          accessibilityRole="tablist"
          style={[
            styles.bottomNavigation,
            { backgroundColor: colors.card, borderTopColor: colors.border },
          ]}
        >
          {items.map(item => (
            <NavigationButton
              active={item.id === activeItemId}
              compact
              item={item}
              key={item.id}
              onPress={() => onNavigate(item.id)}
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.horizontal, { backgroundColor: colors.background }]}>
      <View
        style={[
          expanded ? styles.sidebar : styles.rail,
          { backgroundColor: colors.card, borderRightColor: colors.border },
        ]}
      >
        <View style={styles.brand}>
          <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
            <Text color="primary-foreground" variant="label" weight="bold">
              L
            </Text>
          </View>
          {expanded ? <Text weight="bold">{brand}</Text> : null}
        </View>
        <View accessibilityRole="tablist" style={styles.navigationList}>
          {items.map(item => (
            <NavigationButton
              active={item.id === activeItemId}
              item={item}
              key={item.id}
              onPress={() => onNavigate(item.id)}
              showLabel={expanded}
            />
          ))}
        </View>
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

function NavigationButton({
  active,
  compact = false,
  item,
  onPress,
  showLabel = true,
}: Readonly<{
  active: boolean;
  compact?: boolean;
  item: AppShellItem;
  onPress: () => void;
  showLabel?: boolean;
}>) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        compact ? styles.compactNavigationButton : styles.navigationButton,
        active && { backgroundColor: colors.accent },
        pressed && { opacity: tokens.opacity.pressed },
      ]}
    >
      <Icon
        color={active ? 'accent-foreground' : 'muted-foreground'}
        name={item.icon}
        size="sm"
      />
      {showLabel ? (
        <Text
          color={active ? 'accent-foreground' : 'muted-foreground'}
          numberOfLines={1}
          variant="caption"
          weight="medium"
        >
          {item.label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: { flex: 1 },
  horizontal: { flex: 1, flexDirection: 'row' },
  content: { flex: 1, minWidth: 0 },
  bottomNavigation: {
    borderTopWidth: tokens.stroke.thin,
    flexDirection: 'row',
    padding: tokens.space['2xs'],
  },
  compactNavigationButton: {
    alignItems: 'center',
    borderRadius: tokens.radius.sm,
    flex: 1,
    gap: tokens.space['2xs'],
    justifyContent: 'center',
    minHeight: tokens.control.height.comfortable,
    paddingHorizontal: tokens.space['2xs'],
  },
  rail: {
    alignItems: 'center',
    borderRightWidth: tokens.stroke.thin,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.lg,
    width: tokens.space['5xl'] + tokens.space.xs,
  },
  sidebar: {
    borderRightWidth: tokens.stroke.thin,
    padding: tokens.space.lg,
    width: tokens.layout.navigation.rail,
  },
  brand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: tokens.space.sm,
  },
  brandMark: {
    alignItems: 'center',
    borderRadius: tokens.radius.sm,
    height: tokens.control.height.compact,
    justifyContent: 'center',
    width: tokens.control.height.compact,
  },
  navigationList: { gap: tokens.space['2xs'], marginTop: tokens.space.xl },
  navigationButton: {
    alignItems: 'center',
    borderRadius: tokens.radius.sm,
    flexDirection: 'row',
    gap: tokens.space.xs,
    justifyContent: 'center',
    minHeight: tokens.control.height.standard,
    paddingHorizontal: tokens.space.sm,
  },
});
