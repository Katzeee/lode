import { tokens } from '@lode/design-tokens';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './text';
import { useColors } from './theme';

export function PageScaffold({
  actions,
  children,
  description,
  eyebrow,
  title,
}: Readonly<{
  actions?: ReactNode;
  children: ReactNode;
  description?: string;
  eyebrow?: string;
  title: string;
}>) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentContainerStyle={[
        styles.scrollContent,
        {
          paddingBottom: insets.bottom + tokens.layout['safe-area'].minimum,
          paddingTop: insets.top + tokens.layout['safe-area'].minimum,
        },
      ]}
      style={{ backgroundColor: colors.background }}
    >
      <View style={styles.page}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headingCopy}>
            {eyebrow === undefined ? null : (
              <Text
                color="primary"
                style={styles.eyebrow}
                variant="caption"
                weight="semibold"
              >
                {eyebrow.toUpperCase()}
              </Text>
            )}
            <Text variant="page-title" weight="medium">
              {title}
            </Text>
            {description === undefined ? null : (
              <Text color="muted-foreground" style={styles.description}>
                {description}
              </Text>
            )}
          </View>
          {actions === undefined ? null : (
            <View style={styles.actions}>{actions}</View>
          )}
        </View>
        <View style={styles.body}>{children}</View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    alignItems: 'center',
    flexGrow: 1,
    paddingHorizontal: tokens.layout['safe-area'].minimum,
  },
  page: { maxWidth: tokens.layout.content.standard, width: '100%' },
  header: {
    borderBottomWidth: tokens.stroke.thin,
    gap: tokens.space.md,
    paddingBottom: tokens.space.lg,
  },
  headingCopy: { gap: tokens.space.xs },
  eyebrow: { letterSpacing: 1.1 },
  description: { maxWidth: tokens.layout.content.reading },
  actions: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: tokens.space.xs,
  },
  body: { paddingTop: tokens.space.xl },
});
