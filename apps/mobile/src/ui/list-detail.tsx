import { tokens } from '@lode/design-tokens';
import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button } from './button';
import { useColors } from './theme';

export function ListDetail({
  detail,
  detailVisible,
  list,
  onBack,
}: Readonly<{
  detail: ReactNode;
  detailVisible: boolean;
  list: ReactNode;
  onBack: () => void;
}>) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const expanded = width >= tokens.layout.breakpoint.expanded;
  return (
    <View
      style={[
        styles.frame,
        expanded && styles.expanded,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {expanded || !detailVisible ? (
        <View
          accessibilityLabel="Items"
          style={[styles.list, expanded && { borderRightColor: colors.border }]}
        >
          {list}
        </View>
      ) : null}
      {expanded || detailVisible ? (
        <View accessibilityLabel="Details" style={styles.detail}>
          {expanded ? null : (
            <View style={[styles.back, { borderBottomColor: colors.border }]}>
              <Button onPress={onBack} size="sm" variant="ghost">
                ← Back to list
              </Button>
            </View>
          )}
          {detail}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: tokens.radius.lg,
    borderWidth: tokens.stroke.thin,
    overflow: 'hidden',
  },
  expanded: { flexDirection: 'row' },
  list: { borderRightWidth: 0, flex: 0.72, minWidth: 0 },
  detail: { flex: 1.28, minWidth: 0 },
  back: {
    borderBottomWidth: tokens.stroke.thin,
    padding: tokens.space.xs,
  },
});
