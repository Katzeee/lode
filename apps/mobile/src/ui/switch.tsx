import { Switch as NativeSwitch, StyleSheet, View } from 'react-native';
import { tokens } from '@lode/design-tokens';

import { Text } from './text';
import { useColors } from './theme';

export function Switch({
  description,
  disabled = false,
  label,
  onValueChange,
  value,
}: Readonly<{
  description?: string;
  disabled?: boolean;
  label: string;
  onValueChange?: (value: boolean) => void;
  value: boolean;
}>) {
  const colors = useColors();
  return (
    <View
      style={[styles.row, disabled && { opacity: tokens.opacity.disabled }]}
    >
      <View style={styles.copy}>
        <Text variant="label" weight="medium">
          {label}
        </Text>
        {description === undefined ? null : (
          <Text color="muted-foreground" variant="caption">
            {description}
          </Text>
        )}
      </View>
      <NativeSwitch
        accessibilityHint={description}
        accessibilityLabel={label}
        disabled={disabled}
        onValueChange={onValueChange}
        thumbColor={colors.card}
        trackColor={{ false: colors.input, true: colors.primary }}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: tokens.space.md,
    justifyContent: 'space-between',
  },
});
