import { StyleSheet, View, type ViewProps } from 'react-native';
import { tokens } from '@lode/design-tokens';

import { Text } from './text';
import { useColors } from './theme';

export function Card({ style, ...properties }: ViewProps) {
  const colors = useColors();
  return (
    <View
      {...properties}
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        style,
      ]}
    />
  );
}

export function CardTitle({ children }: Readonly<{ children: string }>) {
  return (
    <Text color="card-foreground" variant="title-small" weight="semibold">
      {children}
    </Text>
  );
}

export function CardDescription({ children }: Readonly<{ children: string }>) {
  return (
    <Text color="muted-foreground" style={styles.description}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tokens.radius.lg,
    borderWidth: tokens.stroke.thin,
    padding: tokens.space.lg,
  },
  description: {
    marginTop: tokens.space['2xs'],
  },
});
