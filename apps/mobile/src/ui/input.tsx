import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { tokens } from '@lode/design-tokens';

import { lodeFontFamily } from './text';
import { useColors } from './theme';

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
