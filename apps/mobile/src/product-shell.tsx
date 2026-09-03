import {
  Alert,
  AppShell,
  Badge,
  BadgeDot,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  PageScaffold,
  type AppShellSection,
} from '@lode/ui';
import { useState } from 'react';

import type { EngineHostState } from './engine-worker/protocol.js';
import { describeError } from './host-message.js';

const navigationSections: readonly AppShellSection[] = [
  {
    id: 'primary',
    items: [
      { id: 'product', icon: 'house', label: 'Home', target: '#/' },
      {
        id: 'design-system',
        icon: 'shapes',
        label: 'Design system',
        target: '#/design-system',
      },
      { id: 'legal', icon: 'type', label: 'Legal', target: '#/legal' },
    ],
  },
];

export function ProductShell({
  error,
  hostState,
  onOpenLocal,
}: Readonly<{
  error: string | null;
  hostState: EngineHostState;
  onOpenLocal(passphrase: string, workspaceLabel: string): Promise<void>;
}>) {
  const [passphrase, setPassphrase] = useState('');
  const [workspaceLabel, setWorkspaceLabel] = useState('My Workspace');
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const ready = hostState.phase !== 'starting';
  const unlocked = hostState.phase === 'ready';

  const submit = async () => {
    if (passphrase.length < 8) {
      setCommandError('Passphrase must contain at least 8 characters.');
      return;
    }
    if (workspaceLabel.trim().length === 0) {
      setCommandError('Workspace name is required.');
      return;
    }
    setBusy(true);
    setCommandError(null);
    try {
      await onOpenLocal(passphrase, workspaceLabel.trim());
      setPassphrase('');
    } catch (caught) {
      setCommandError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell activeItemId="product" sections={navigationSections}>
      <PageScaffold
        actions={
          <Badge tone={unlocked ? 'success' : ready ? 'warning' : 'neutral'}>
            <BadgeDot />
            {unlocked ? 'Ready' : ready ? 'Locked' : 'Starting'}
          </Badge>
        }
        description="The Engine runs in a dedicated Worker and stores its authoritative data in native SQLite."
        eyebrow="Local knowledge, one authority"
        title="Your local knowledge space"
      >
        <Card data-phase={hostState.phase}>
          <CardHeader>
            <CardTitle>
              {unlocked
                ? 'Engine ready'
                : ready
                  ? hostState.vaultExists
                    ? 'Vault locked'
                    : 'Ready to initialize'
                  : 'Starting Engine'}
            </CardTitle>
            <CardDescription>
              {hostState.actors.length} actor
              {hostState.actors.length === 1 ? '' : 's'} and{' '}
              {hostState.workspaces.length} workspace
              {hostState.workspaces.length === 1 ? '' : 's'}
            </CardDescription>
          </CardHeader>
          <div className="p-6">
            {!unlocked && ready ? (
              <div className="flex flex-col gap-5">
                {!hostState.vaultExists ? (
                  <Field>
                    <FieldLabel>Workspace name</FieldLabel>
                    <Input
                      autoCapitalize="sentences"
                      onChange={event => setWorkspaceLabel(event.target.value)}
                      placeholder="My Workspace"
                      value={workspaceLabel}
                    />
                    <FieldDescription>
                      Only visible on this device.
                    </FieldDescription>
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel>Vault passphrase</FieldLabel>
                  <Input
                    autoCapitalize="none"
                    autoComplete={
                      hostState.vaultExists
                        ? 'current-password'
                        : 'new-password'
                    }
                    onChange={event => setPassphrase(event.target.value)}
                    placeholder="At least 8 characters"
                    type="password"
                    value={passphrase}
                  />
                </Field>
                <Button loading={busy} onClick={() => void submit()} size="lg">
                  {hostState.vaultExists ? 'Unlock Lode' : 'Create local space'}
                </Button>
              </div>
            ) : null}
            {unlocked ? (
              <div>
                <h2 className="text-title-small font-semibold">
                  {hostState.workspaces[0]?.label ?? 'Local Workspace'}
                </h2>
                <p className="mt-2 text-body text-muted-foreground">
                  The production Engine is open and ready for local knowledge
                  work.
                </p>
              </div>
            ) : null}
          </div>
        </Card>

        {error === null && commandError === null ? null : (
          <Alert className="mt-6" tone="destructive">
            {commandError ?? error}
          </Alert>
        )}
      </PageScaffold>
    </AppShell>
  );
}
