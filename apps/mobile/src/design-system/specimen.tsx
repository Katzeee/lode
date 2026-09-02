import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { tokens } from '@lode/design-tokens';

import { Text } from '../ui/text';
import { useColors } from '../ui/theme';

export function PageIntro({
  description,
  title,
}: Readonly<{ description: string; title: string }>) {
  return (
    <View style={styles.intro}>
      <Text variant="page-title" weight="medium">
        {title}
      </Text>
      <Text color="muted-foreground" style={styles.introDescription}>
        {description}
      </Text>
    </View>
  );
}

export function Specimen({
  children,
  description,
  title,
}: Readonly<{ children: ReactNode; description?: string; title: string }>) {
  const colors = useColors();
  return (
    <View style={styles.specimen}>
      <Text variant="title-small" weight="semibold">
        {title}
      </Text>
      {description === undefined ? null : (
        <Text
          color="muted-foreground"
          style={styles.description}
          variant="label"
        >
          {description}
        </Text>
      )}
      <View
        style={[
          styles.body,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: tokens.space.xl },
  introDescription: { marginTop: tokens.space.xs },
  specimen: { marginBottom: tokens.space.xl },
  description: { marginTop: tokens.space['2xs'] },
  body: {
    borderRadius: tokens.radius.lg,
    borderWidth: tokens.stroke.thin,
    gap: tokens.space.md,
    marginTop: tokens.space.sm,
    padding: tokens.space.lg,
  },
});
