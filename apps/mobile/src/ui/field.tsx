import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { tokens } from '@lode/design-tokens';

import { Text } from './text';

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

const styles = StyleSheet.create({
  field: {
    gap: tokens.space['2xs'] + 2,
  },
});
