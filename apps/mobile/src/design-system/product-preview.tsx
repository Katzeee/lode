import { StyleSheet, View } from 'react-native';
import { tokens } from '@lode/design-tokens';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardTitle } from '../ui/card';
import { Field, Input } from '../ui/field';
import { Text } from '../ui/text';
import { ThemeProvider, useColors } from '../ui/theme';
import { PageIntro } from './specimen';

export function ProductPreviewPage() {
  return (
    <>
      <PageIntro
        description="The mobile product shell, rendered from the exact components this catalog documents. The product is always dark; the frame below scopes it."
        title="Product preview"
      />
      <ThemeProvider mode="dark">
        <ProductFrame />
      </ThemeProvider>
    </>
  );
}

function ProductFrame() {
  const colors = useColors();
  return (
    <View
      style={[
        styles.frame,
        { backgroundColor: colors.background, borderColor: colors.border },
      ]}
    >
      <View style={styles.topbar}>
        <Text
          color="primary"
          style={styles.eyebrow}
          variant="label"
          weight="bold"
        >
          LODE
        </Text>
        <Badge dot tone="warning">
          Vault locked
        </Badge>
      </View>
      <Text style={styles.title} variant="title" weight="bold">
        Your local knowledge space
      </Text>
      <Card style={styles.card}>
        <CardTitle>Ready to initialize</CardTitle>
        <CardDescription>0 actors · 0 workspaces</CardDescription>
      </Card>
      <View style={styles.form}>
        <Field label="Vault passphrase">
          <Input placeholder="At least 8 characters" secureTextEntry />
        </Field>
        <Button size="lg">Create local space</Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: tokens.radius.xl,
    borderWidth: tokens.stroke.thin,
    padding: tokens.space.lg,
  },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eyebrow: { letterSpacing: 1.8 },
  title: { marginTop: tokens.space.lg },
  card: { marginTop: tokens.space.lg },
  form: { gap: tokens.space.md, marginTop: tokens.space.lg },
});
