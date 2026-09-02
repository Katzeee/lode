import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { tokens } from '@lode/design-tokens';
import type { BadgeTone } from '@lode/design-system-catalog';

import { Text } from './text';
import {
  useColors,
  withAlpha,
  type ColorRole,
  type ThemeColors,
} from './theme';

function toneColors(
  tone: BadgeTone,
  colors: ThemeColors,
): { background: string; border: string; label: ColorRole } {
  switch (tone) {
    case 'neutral': {
      return {
        background: colors.card,
        border: colors.border,
        label: 'muted-foreground',
      };
    }
    case 'accent': {
      return {
        background: colors.accent,
        border: withAlpha(colors.primary, 0.2),
        label: 'accent-foreground',
      };
    }
    case 'success': {
      return {
        background: colors['success-subtle'],
        border: withAlpha(colors.success, 0.25),
        label: 'success-strong',
      };
    }
    case 'warning': {
      return {
        background: colors['warning-subtle'],
        border: withAlpha(colors.warning, 0.3),
        label: 'warning-strong',
      };
    }
    case 'destructive': {
      return {
        background: colors['destructive-subtle'],
        border: withAlpha(colors.destructive, 0.25),
        label: 'destructive-strong',
      };
    }
  }
}

export function Badge({
  children,
  dot = false,
  tone = 'neutral',
}: Readonly<{ children: ReactNode; dot?: boolean; tone?: BadgeTone }>) {
  const colors = useColors();
  const resolved = toneColors(tone, colors);
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: resolved.background, borderColor: resolved.border },
      ]}
    >
      {dot ? (
        <View
          style={[styles.dot, { backgroundColor: colors[resolved.label] }]}
        />
      ) : null}
      <Text color={resolved.label} variant="caption" weight="medium">
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: tokens.radius.full,
    borderWidth: tokens.stroke.thin,
    flexDirection: 'row',
    gap: tokens.space['2xs'] + 2,
    paddingHorizontal: tokens.space.xs + 2,
    paddingVertical: 2,
  },
  dot: {
    borderRadius: tokens.radius.full,
    height: 6,
    width: 6,
  },
});
