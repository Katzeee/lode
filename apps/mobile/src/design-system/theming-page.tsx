import { StyleSheet, View } from 'react-native';
import { tokens } from '@lode/design-tokens';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Text } from '../ui/text';
import {
  accentNames,
  ThemeProvider,
  useColors,
  type AccentName,
  type ThemeMode,
} from '../ui/theme';
import { PageIntro, Specimen } from './specimen';

export function ThemingPage({
  accent,
  onAccentChange,
}: Readonly<{
  accent: AccentName;
  onAccentChange: (accent: AccentName) => void;
}>) {
  return (
    <>
      <PageIntro
        description="Color has two independent axes. The mode axis resolves the neutral world; the accent axis re-tints every action role. A theme is a choice, never a rewrite."
        title="Theming"
      />
      <Specimen
        description="The accent applies to this whole catalog — switch it, then browse any page."
        title="Accent"
      >
        <View style={styles.switcher}>
          {accentNames.map(name => (
            <Button
              key={name}
              onPress={() => onAccentChange(name)}
              size="sm"
              variant={accent === name ? 'primary' : 'outline'}
            >
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </Button>
          ))}
        </View>
      </Specimen>
      <Specimen
        description="Every accent carries both mode resolutions and passes the same contrast gates."
        title="Accent × mode"
      >
        {accentNames.map(name =>
          (['light', 'dark'] as const).map(mode => (
            <ThemeProvider accent={name} key={`${name}-${mode}`} mode={mode}>
              <ThemeFrame accent={name} mode={mode} />
            </ThemeProvider>
          )),
        )}
      </Specimen>
    </>
  );
}

function ThemeFrame({
  accent,
  mode,
}: Readonly<{ accent: AccentName; mode: ThemeMode }>) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.frame,
        { backgroundColor: colors.background, borderColor: colors.border },
      ]}
    >
      <View style={styles.frameHeading}>
        <Text
          color="muted-foreground"
          style={styles.frameLabel}
          variant="caption"
          weight="semibold"
        >
          {accent.toUpperCase()} · {mode.toUpperCase()}
        </Text>
        <Badge dot tone="accent">
          Accent
        </Badge>
      </View>
      <Field label="Vault passphrase">
        <Input placeholder="At least 8 characters" secureTextEntry />
      </Field>
      <View style={styles.frameActions}>
        <Button size="sm">Unlock</Button>
        <Button size="sm" variant="ghost">
          Cancel
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  switcher: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs },
  frame: {
    borderRadius: tokens.radius.lg,
    borderWidth: tokens.stroke.thin,
    gap: tokens.space.sm,
    padding: tokens.space.md,
  },
  frameHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  frameLabel: { letterSpacing: 1.1 },
  frameActions: { flexDirection: 'row', gap: tokens.space.xs },
});
