import { StyleSheet, View } from 'react-native';
import { tokens } from '@lode/design-tokens';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Text } from '../ui/text';
import {
  themeNames,
  ThemeProvider,
  useColors,
  type ThemeMode,
  type ThemeName,
} from '../ui/theme';
import { PageIntro, Specimen } from './specimen';

export function ThemingPage({
  onThemeChange,
  theme,
}: Readonly<{
  onThemeChange: (theme: ThemeName) => void;
  theme: ThemeName;
}>) {
  return (
    <>
      <PageIntro
        description="Color has two independent axes. The mode axis is a system preference; the theme axis is a complete resolution of every semantic color role. Built-in themes ship on every platform."
        title="Theming"
      />
      <Specimen
        description="Switch a theme, then browse any page — the whole catalog renders under it."
        title="Built-in themes"
      >
        <View style={styles.switcher}>
          {themeNames.map(name => (
            <Button
              key={name}
              onPress={() => onThemeChange(name)}
              size="sm"
              variant={theme === name ? 'primary' : 'outline'}
            >
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </Button>
          ))}
        </View>
      </Specimen>
      <Specimen
        description="Each theme resolves both modes and passes the same contrast gates."
        title="Theme × mode"
      >
        {themeNames.map(name =>
          (['light', 'dark'] as const).map(mode => (
            <ThemeProvider key={`${name}-${mode}`} mode={mode} name={name}>
              <ThemeFrame mode={mode} name={name} />
            </ThemeProvider>
          )),
        )}
      </Specimen>
    </>
  );
}

function ThemeFrame({
  mode,
  name,
}: Readonly<{ mode: ThemeMode; name: ThemeName }>) {
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
          {name.toUpperCase()} · {mode.toUpperCase()}
        </Text>
        <Badge dot tone="success">
          Ready
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
