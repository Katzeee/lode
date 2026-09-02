import { fontNotices, tokens } from '@lode/design-tokens';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from './ui/button';
import { Text } from './ui/text';
import { useColors } from './ui/theme';

export function MobileLegalPage({
  onClose,
}: Readonly<{ onClose: () => void }>) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        {
          paddingBottom: insets.bottom + tokens.space['4xl'],
          paddingTop: insets.top + tokens.space.md,
        },
      ]}
      style={{ backgroundColor: colors.background, flex: 1 }}
    >
      <View style={styles.topbar}>
        <Text weight="semibold">Legal & acknowledgements</Text>
        <Button onPress={onClose} size="sm" variant="outline">
          Close
        </Button>
      </View>
      <Text
        color="primary"
        style={styles.eyebrow}
        variant="caption"
        weight="bold"
      >
        TYPOGRAPHY LICENSES
      </Text>
      <Text style={styles.title} variant="display" weight="medium">
        HarmonyOS Sans
      </Text>
      <Text color="muted-foreground" style={styles.attribution}>
        {fontNotices.harmonyOsSans.attribution}
      </Text>
      <View style={[styles.license, { borderTopColor: colors.border }]}>
        <Text variant="title-small" weight="semibold">
          HarmonyOS Sans Fonts License Agreement
        </Text>
        <Text
          color="muted-foreground"
          selectable
          style={styles.licenseText}
          variant="caption"
        >
          {fontNotices.harmonyOsSans.license}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: tokens.space.xl },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: tokens.control.height.comfortable,
  },
  eyebrow: { letterSpacing: 1.1, marginTop: tokens.space['4xl'] },
  title: { marginTop: tokens.space.sm },
  attribution: { marginTop: tokens.space.lg },
  license: {
    borderTopWidth: tokens.stroke.thin,
    marginTop: tokens.space['3xl'],
    paddingTop: tokens.space['2xl'],
  },
  licenseText: { marginTop: tokens.space.lg },
});
