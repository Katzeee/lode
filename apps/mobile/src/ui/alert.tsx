import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { tokens } from '@lode/design-tokens';
import type { AlertTone } from '@lode/design-system-catalog';

import { Text } from './text';
import {
  useColors,
  withAlpha,
  type ColorRole,
  type ThemeColors,
} from './theme';

function toneColors(
  tone: AlertTone,
  colors: ThemeColors,
): { background: string; border: string; label: ColorRole } {
  switch (tone) {
    case 'neutral': {
      return {
        background: colors.card,
        border: colors.border,
        label: 'foreground',
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

export function Alert({
  children,
  title,
  tone = 'neutral',
}: Readonly<{ children: ReactNode; title?: string; tone?: AlertTone }>) {
  const colors = useColors();
  const resolved = toneColors(tone, colors);
  const role = tone === 'destructive' ? 'alert' : undefined;
  return (
    <View
      accessibilityRole={role}
      style={[
        styles.alert,
        { backgroundColor: resolved.background, borderColor: resolved.border },
      ]}
    >
      {title === undefined ? null : (
        <Text color={resolved.label} style={styles.title} weight="semibold">
          {title}
        </Text>
      )}
      <Text color={resolved.label} selectable>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  alert: {
    borderRadius: tokens.radius.md,
    borderWidth: tokens.stroke.thin,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    width: '100%',
  },
  title: {
    marginBottom: tokens.space['2xs'],
  },
});
