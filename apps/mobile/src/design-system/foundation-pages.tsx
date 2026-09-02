import { StyleSheet, View } from 'react-native';
import { tokens } from '@lode/design-tokens';

import { Text } from '../ui/text';
import { useColors, type ColorRole } from '../ui/theme';
import { PageIntro, Specimen } from './specimen';

const colorGroups: readonly { title: string; roles: readonly ColorRole[] }[] = [
  {
    title: 'Canvas & surfaces',
    roles: ['background', 'card', 'muted', 'accent'],
  },
  {
    title: 'Text',
    roles: ['foreground', 'muted-foreground', 'accent-foreground'],
  },
  {
    title: 'Action',
    roles: ['primary', 'primary-foreground', 'secondary', 'ring'],
  },
  {
    title: 'Feedback',
    roles: [
      'success',
      'success-subtle',
      'warning',
      'warning-subtle',
      'destructive',
      'destructive-subtle',
    ],
  },
  { title: 'Lines', roles: ['border', 'input'] },
];

export function ColorPage() {
  const colors = useColors();
  return (
    <>
      <PageIntro
        description="Semantic roles are the only color API. Toggle the catalog theme to watch every swatch resolve its other value."
        title="Color"
      />
      {colorGroups.map(group => (
        <Specimen key={group.title} title={group.title}>
          <View style={styles.swatchGrid}>
            {group.roles.map(role => (
              <View key={role} style={styles.swatch}>
                <View
                  style={[
                    styles.swatchColor,
                    {
                      backgroundColor: colors[role],
                      borderColor: colors.border,
                    },
                  ]}
                />
                <Text color="muted-foreground" mono variant="caption">
                  {role}
                </Text>
              </View>
            ))}
          </View>
        </Specimen>
      ))}
    </>
  );
}

const typeScale = Object.keys(
  tokens.font.size,
) as readonly (keyof typeof tokens.font.size)[];

export function TypographyPage() {
  return (
    <>
      <PageIntro
        description="HarmonyOS Sans SC carries both interface and document text; JetBrains Mono carries identities and code."
        title="Typography"
      />
      <Specimen title="Type scale">
        {typeScale.map(name => (
          <View key={name} style={styles.typeRow}>
            <Text
              color="muted-foreground"
              mono
              style={styles.typeName}
              variant="caption"
            >
              {name} · {tokens.font.size[name]}px
            </Text>
            <Text numberOfLines={1} variant={name}>
              知识长存 Local knowledge
            </Text>
          </View>
        ))}
      </Specimen>
      <Specimen title="Multilingual rendering">
        <Text variant="body-large">
          Lode 将你的知识保存在本地 — every fact, decision, and revision stays
          on hardware you own.
        </Text>
        <Text color="muted-foreground" mono>
          workspace_9f3a…c21b · JetBrains Mono fallback
        </Text>
      </Specimen>
    </>
  );
}

const radii = Object.entries(tokens.radius) as readonly [string, number][];
const spaceSteps = Object.entries(tokens.space) as readonly [string, number][];

const { breakpoint, grid, gutter } = tokens.layout;
const windowClasses = [
  {
    id: 'compact',
    range: `0–${breakpoint.medium - 1}px`,
    columns: grid.compact,
    gutter: gutter.compact,
  },
  {
    id: 'medium',
    range: `${breakpoint.medium}–${breakpoint.expanded - 1}px`,
    columns: grid.medium,
    gutter: gutter.regular,
  },
  {
    id: 'expanded',
    range: `${breakpoint.expanded}–${breakpoint.large - 1}px`,
    columns: grid.expanded,
    gutter: gutter.regular,
  },
  {
    id: 'large',
    range: `${breakpoint.large}–${breakpoint['extra-large'] - 1}px`,
    columns: grid.expanded,
    gutter: gutter.expanded,
  },
  {
    id: 'extra-large',
    range: `≥ ${breakpoint['extra-large']}px`,
    columns: grid.expanded,
    gutter: gutter.expanded,
  },
] as const;

export function GeometryPage() {
  const colors = useColors();
  return (
    <>
      <PageIntro
        description="A 4px rhythm, six radii, and motion that stays under 200ms."
        title="Geometry & motion"
      />
      <Specimen
        description="Every Lode surface resolves the same classes from its own window width — the same numbers drive desktop breakpoints and this shell."
        title="Window classes"
      >
        {windowClasses.map(windowClass => (
          <View key={windowClass.id} style={styles.windowClassRow}>
            <Text style={styles.windowClassName} weight="medium">
              {windowClass.id}
            </Text>
            <Text color="muted-foreground" mono variant="caption">
              {windowClass.range} · {windowClass.columns} columns ·{' '}
              {windowClass.gutter}px gutter
            </Text>
          </View>
        ))}
      </Specimen>
      <Specimen
        description="Spacing utilities resolve against the 4px grid."
        title="Spacing rhythm"
      >
        <View style={styles.spacingRow}>
          {spaceSteps.map(([name, value]) => (
            <View key={name} style={styles.spacingStep}>
              <View
                style={[
                  styles.spacingBar,
                  { backgroundColor: colors.primary, height: value },
                ]}
              />
              <Text color="muted-foreground" mono variant="caption">
                {name}
              </Text>
            </View>
          ))}
        </View>
      </Specimen>
      <Specimen title="Radii">
        <View style={styles.swatchGrid}>
          {radii.map(([name, value]) => (
            <View key={name} style={styles.swatch}>
              <View
                style={[
                  styles.radiusSample,
                  {
                    backgroundColor: colors.accent,
                    borderColor: colors.border,
                    borderRadius: Math.min(value, 32),
                  },
                ]}
              />
              <Text color="muted-foreground" mono variant="caption">
                {name} · {value}px
              </Text>
            </View>
          ))}
        </View>
      </Specimen>
      <Specimen title="Motion">
        {Object.entries(tokens.motion.duration).map(([name, value]) => (
          <View key={name} style={styles.typeRow}>
            <Text
              color="muted-foreground"
              mono
              style={styles.typeName}
              variant="caption"
            >
              {name}
            </Text>
            <Text color="muted-foreground">
              {value}ms · cubic-bezier(0.2, 0, 0, 1)
            </Text>
          </View>
        ))}
      </Specimen>
    </>
  );
}

const styles = StyleSheet.create({
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.space.md,
  },
  swatch: { gap: tokens.space['2xs'], width: 132 },
  swatchColor: {
    borderRadius: tokens.radius.md,
    borderWidth: tokens.stroke.thin,
    height: 56,
  },
  typeRow: { gap: 2 },
  typeName: { marginBottom: 2 },
  spacingRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.space.sm,
  },
  spacingStep: { alignItems: 'center', gap: tokens.space['2xs'] },
  spacingBar: { borderRadius: tokens.radius.xs, width: 20 },
  windowClassRow: { gap: 2 },
  windowClassName: { textTransform: 'capitalize' },
  radiusSample: {
    borderWidth: tokens.stroke.thin,
    height: 56,
    width: 56,
  },
});
