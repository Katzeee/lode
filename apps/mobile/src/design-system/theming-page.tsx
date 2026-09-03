import { StyleSheet, View } from 'react-native';
import { themeVariableGroups, tokens } from '@lode/design-tokens';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { Text } from '../ui/text';
import {
  themeNames,
  ThemeProvider,
  useColors,
  useThemeMode,
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
      <ThemeVariablesSpecimen theme={theme} />
    </>
  );
}

function ThemeVariablesSpecimen({ theme }: Readonly<{ theme: ThemeName }>) {
  const mode = useThemeMode();
  const colors = useColors();
  return (
    <Specimen
      description="This generated list is the complete desktop custom-theme API. Values resolve for the active built-in theme and mode; mobile consumes the same source tokens directly."
      title="Variables"
    >
      {themeVariableGroups.map(group => (
        <View key={group.id} style={styles.variableGroup}>
          <Text variant="label" weight="semibold">
            {group.title}
          </Text>
          {group.variables.map(variable => {
            const value = variable.values[theme][mode];
            return (
              <View
                key={variable.name}
                style={[styles.variableRow, { borderColor: colors.border }]}
              >
                {variable.kind === 'color' ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    style={[
                      styles.variableSwatch,
                      {
                        backgroundColor: value,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                ) : null}
                <View style={styles.variableText}>
                  <Text mono selectable variant="caption">
                    {variable.name}
                  </Text>
                  <Text
                    color="muted-foreground"
                    mono
                    selectable
                    variant="caption"
                  >
                    {value}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </Specimen>
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
  variableGroup: { gap: tokens.space.xs },
  variableRow: {
    alignItems: 'center',
    borderTopWidth: tokens.stroke.thin,
    flexDirection: 'row',
    gap: tokens.space.sm,
    paddingTop: tokens.space.xs,
  },
  variableSwatch: {
    borderRadius: tokens.radius.xs,
    borderWidth: tokens.stroke.thin,
    height: tokens.control.height.compact,
    width: tokens.control.height.compact,
  },
  variableText: { flex: 1, gap: tokens.space['2xs'] },
});
