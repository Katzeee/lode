import { StyleSheet, View } from 'react-native';
import { tokens } from '@lode/design-tokens';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardTitle } from '../ui/card';
import { PageIntro, Specimen } from './specimen';

const principles = [
  {
    title: 'One token source',
    detail:
      'Every color, size, radius, and duration resolves from the design-tokens package. Components and screens never carry raw values.',
  },
  {
    title: 'One component layer',
    detail:
      'Product screens render exclusively through the ui components. A visual change lands in one file and reaches every surface.',
  },
  {
    title: 'Modes, themes, one vocabulary',
    detail:
      'Light and dark modes and built-in themes all resolve the same semantic roles. The theme provider switches a whole region wholesale — no per-component theming.',
  },
] as const;

export function OverviewPage() {
  return (
    <>
      <PageIntro
        description="The interface system behind every Lode surface: paper-calm in the light, forest-deep in the dark, HarmonyOS Sans throughout."
        title="Lode Design System"
      />
      <View style={styles.principles}>
        {principles.map(principle => (
          <Card key={principle.title}>
            <CardTitle>{principle.title}</CardTitle>
            <CardDescription>{principle.detail}</CardDescription>
          </Card>
        ))}
      </View>
      <Specimen
        description="A quick taste of the working component layer."
        title="At a glance"
      >
        <View style={styles.glanceRow}>
          <Button>Primary action</Button>
          <Button variant="outline">Outline</Button>
        </View>
        <View style={styles.glanceRow}>
          <Badge tone="success">Ready</Badge>
          <Badge tone="accent">Local-first</Badge>
        </View>
      </Specimen>
    </>
  );
}

const styles = StyleSheet.create({
  principles: {
    gap: tokens.space.md,
    marginBottom: tokens.space.xl,
  },
  glanceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.space.sm,
  },
});
