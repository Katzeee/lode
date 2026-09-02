import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '@lode/design-tokens';

import type { EngineHostState } from './engine-host-protocol';
import type { MobileSurface } from './mobile-shell-state';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { Card, CardDescription, CardTitle } from './ui/card';
import { Field } from './ui/field';
import { Input } from './ui/input';
import { Text } from './ui/text';
import { useColors } from './ui/theme';

export function ProductShell({
  busy,
  error,
  hostState,
  onNavigate,
  onOpenLocal,
  onPassphraseChange,
  onWorkspaceLabelChange,
  passphrase,
  workspaceLabel,
}: Readonly<{
  busy: boolean;
  error: string | null;
  hostState: EngineHostState;
  onNavigate: (surface: MobileSurface) => void;
  onOpenLocal: () => void;
  onPassphraseChange: (value: string) => void;
  onWorkspaceLabelChange: (value: string) => void;
  passphrase: string;
  workspaceLabel: string;
}>) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const ready = hostState.phase !== 'starting';
  const unlocked = hostState.phase === 'ready';

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + tokens.space.xl,
          paddingBottom: insets.bottom + tokens.space['2xl'],
        },
      ]}
      style={{ backgroundColor: colors.background }}
    >
      <View style={styles.topbar}>
        <Text
          color="primary"
          variant="label"
          weight="bold"
          style={styles.eyebrow}
        >
          LODE
        </Text>
        <View style={styles.topbarLinks}>
          <Button
            onPress={() => onNavigate('design-system')}
            size="sm"
            variant="ghost"
          >
            Design system
          </Button>
          <Button onPress={() => onNavigate('legal')} size="sm" variant="ghost">
            Legal
          </Button>
        </View>
      </View>

      <Text style={styles.title} variant="page-title" weight="bold">
        Your local knowledge space
      </Text>
      <Text color="muted-foreground" style={styles.intro} variant="body-large">
        The Engine runs locally and stores its authoritative data in native
        SQLite. This shell is the starting point for the mobile interface.
      </Text>

      <Card style={styles.statusCard}>
        <View style={styles.statusHeading}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: unlocked
                  ? colors.success
                  : ready
                    ? colors.warning
                    : colors['muted-foreground'],
              },
            ]}
          />
          <CardTitle>
            {unlocked
              ? 'Engine ready'
              : ready
                ? hostState.vaultExists
                  ? 'Vault locked'
                  : 'Ready to initialize'
                : 'Starting Engine'}
          </CardTitle>
        </View>
        <CardDescription>
          {`${hostState.actors.length} actor${hostState.actors.length === 1 ? '' : 's'} · ${hostState.workspaces.length} workspace${hostState.workspaces.length === 1 ? '' : 's'}`}
        </CardDescription>
      </Card>

      {!unlocked && ready ? (
        <View style={styles.form}>
          {!hostState.vaultExists ? (
            <Field
              label="Workspace name"
              description="Only visible on this device."
            >
              <Input
                autoCapitalize="sentences"
                onChangeText={onWorkspaceLabelChange}
                placeholder="My Workspace"
                value={workspaceLabel}
              />
            </Field>
          ) : null}
          <Field label="Vault passphrase">
            <Input
              autoCapitalize="none"
              onChangeText={onPassphraseChange}
              onSubmitEditing={onOpenLocal}
              placeholder="At least 8 characters"
              secureTextEntry
              value={passphrase}
            />
          </Field>
          <Button loading={busy} onPress={onOpenLocal} size="lg">
            {hostState.vaultExists ? 'Unlock Lode' : 'Create local space'}
          </Button>
        </View>
      ) : null}

      {unlocked ? (
        <Card style={styles.statusCard}>
          <CardTitle>
            {hostState.workspaces[0]?.label ?? 'Local Workspace'}
          </CardTitle>
          <CardDescription>
            The production Engine is open. Product navigation and editors attach
            to this shell in the UI phase.
          </CardDescription>
        </Card>
      ) : null}

      {error !== null ? (
        <View style={styles.errorSlot}>
          <Alert tone="destructive">{error}</Alert>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: tokens.space.xl },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topbarLinks: { flexDirection: 'row', gap: tokens.space['2xs'] },
  eyebrow: { letterSpacing: 1.8 },
  title: { marginTop: tokens.space.xl },
  intro: { marginTop: tokens.space.sm },
  statusCard: { marginTop: tokens.space.xl },
  statusHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: tokens.space.xs,
  },
  statusDot: { borderRadius: tokens.radius.full, height: 12, width: 12 },
  form: { gap: tokens.space.lg, marginTop: tokens.space.xl },
  errorSlot: { marginTop: tokens.space.lg },
});
