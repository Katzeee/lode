import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import type { ReactNode } from 'react';
import { tokens } from '@lode/design-tokens';

import { lodeFontFamily, Text } from './text';
import { useColors } from './theme';

export function Field({
  children,
  description,
  error,
  label,
}: Readonly<{
  children: ReactNode;
  description?: string;
  error?: string;
  label: string;
}>) {
  return (
    <View style={styles.field}>
      <Text variant="label" weight="medium">
        {label}
      </Text>
      {children}
      {error !== undefined ? (
        <Text
          accessibilityLiveRegion="polite"
          color="destructive"
          variant="caption"
          weight="medium"
        >
          {error}
        </Text>
      ) : description !== undefined ? (
        <Text color="muted-foreground" variant="caption">
          {description}
        </Text>
      ) : null}
    </View>
  );
}

export function Input({
  invalid = false,
  style,
  ...properties
}: TextInputProps & Readonly<{ invalid?: boolean }>) {
  const colors = useColors();
  const readOnly =
    properties.readOnly === true || properties.editable === false;
  return (
    <TextInput
      {...properties}
      placeholderTextColor={colors['muted-foreground']}
      style={[
        styles.input,
        {
          backgroundColor: readOnly ? colors.muted : colors.card,
          borderColor: invalid ? colors.destructive : colors.input,
          color: colors.foreground,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  field: {
    gap: tokens.space['2xs'] + 2,
  },
  input: {
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.stroke.thin,
    fontFamily: lodeFontFamily,
    fontSize: tokens.font.size['body-large'],
    minHeight: tokens.control.height.comfortable,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.xs,
  },
});
