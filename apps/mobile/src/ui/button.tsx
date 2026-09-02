import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { tokens } from '@lode/design-tokens';
import type { ButtonSize, ButtonVariant } from '@lode/design-system-catalog';

import { Spinner } from './spinner';
import { Text, type TextVariant } from './text';
import { useColors, type ColorRole, type ThemeColors } from './theme';

const sizeStyles: Readonly<
  Record<
    ButtonSize,
    { minHeight: number; paddingHorizontal: number; text: TextVariant }
  >
> = {
  sm: {
    minHeight: tokens.control.height.compact,
    paddingHorizontal: tokens.space.sm,
    text: 'label',
  },
  md: {
    minHeight: tokens.control.height.standard,
    paddingHorizontal: tokens.space.md,
    text: 'label',
  },
  lg: {
    minHeight: tokens.control.height.comfortable,
    paddingHorizontal: tokens.space.lg,
    text: 'body',
  },
};

function variantStyle(variant: ButtonVariant, colors: ThemeColors): ViewStyle {
  switch (variant) {
    case 'primary': {
      return { backgroundColor: colors.primary };
    }
    case 'secondary': {
      return { backgroundColor: colors.secondary };
    }
    case 'outline': {
      return {
        backgroundColor: colors.card,
        borderColor: colors.input,
        borderWidth: tokens.stroke.thin,
      };
    }
    case 'ghost': {
      return { backgroundColor: 'transparent' };
    }
    case 'destructive': {
      return { backgroundColor: colors.destructive };
    }
  }
}

const labelColors: Readonly<Record<ButtonVariant, ColorRole>> = {
  primary: 'primary-foreground',
  secondary: 'secondary-foreground',
  outline: 'foreground',
  ghost: 'muted-foreground',
  destructive: 'destructive-foreground',
};

export function Button({
  children,
  disabled = false,
  loading = false,
  onPress,
  size = 'md',
  variant = 'primary',
}: Readonly<{
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onPress?: () => void;
  size?: ButtonSize;
  variant?: ButtonVariant;
}>) {
  const colors = useColors();
  const blocked = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: loading || undefined, disabled: blocked }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: sizeStyles[size].minHeight,
          paddingHorizontal: sizeStyles[size].paddingHorizontal,
        },
        variantStyle(variant, colors),
        pressed && { opacity: tokens.opacity.pressed },
        blocked && { opacity: tokens.opacity.disabled },
      ]}
    >
      {loading ? <Spinner color={colors[labelColors[variant]]} /> : null}
      <Text
        color={labelColors[variant]}
        variant={sizeStyles[size].text}
        weight="medium"
      >
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: tokens.radius.sm,
    flexDirection: 'row',
    gap: tokens.space.xs,
    justifyContent: 'center',
  },
});
