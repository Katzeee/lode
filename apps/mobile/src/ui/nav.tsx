import { Pressable, StyleSheet, View } from 'react-native';
import { tokens } from '@lode/design-tokens';

import { Text } from './text';
import { useColors } from './theme';

export function NavRow({
  description,
  onPress,
  title,
}: Readonly<{ description?: string; onPress: () => void; title: string }>) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { opacity: tokens.opacity.pressed },
      ]}
    >
      <View style={styles.copy}>
        <Text weight="medium">{title}</Text>
        {description === undefined ? null : (
          <Text color="muted-foreground" variant="caption">
            {description}
          </Text>
        )}
      </View>
      <Text color="muted-foreground" variant="title-small">
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: tokens.radius.md,
    borderWidth: tokens.stroke.thin,
    flexDirection: 'row',
    gap: tokens.space.sm,
    justifyContent: 'space-between',
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  copy: { flex: 1, gap: 2, minWidth: 0 },
});
