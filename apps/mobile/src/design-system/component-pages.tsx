import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@lode/design-tokens';
import {
  alertTones,
  badgeTones,
  buttonSizes,
  buttonVariants,
} from '@lode/design-system-catalog';

import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardTitle } from '../ui/card';
import { Field, Input } from '../ui/field';
import { Spinner } from '../ui/spinner';
import { Switch } from '../ui/switch';
import { PageIntro, Specimen } from './specimen';

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ButtonsPage() {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageIntro
        description="One action hierarchy for every surface. Pressed, busy, and disabled states come from the component, never from screens."
        title="Buttons"
      />
      <Specimen
        description="Exactly one primary action per view."
        title="Variants"
      >
        <View style={styles.wrapRow}>
          {buttonVariants.map(variant => (
            <Button key={variant} variant={variant}>
              {capitalize(variant)}
            </Button>
          ))}
        </View>
      </Specimen>
      <Specimen title="Sizes">
        <View style={styles.wrapRow}>
          {buttonSizes.map(size => (
            <Button key={size} size={size} variant="secondary">
              Size {size}
            </Button>
          ))}
        </View>
      </Specimen>
      <Specimen
        description="A busy button announces itself and blocks re-entry."
        title="States"
      >
        <View style={styles.wrapRow}>
          <Button
            loading={busy}
            onPress={() => {
              setBusy(true);
              setTimeout(() => setBusy(false), 1600);
            }}
          >
            {busy ? 'Working…' : 'Tap to load'}
          </Button>
          <Button disabled>Disabled</Button>
          <Button loading variant="outline">
            Saving
          </Button>
        </View>
      </Specimen>
    </>
  );
}

export function FormsPage() {
  const [stayUnlocked, setStayUnlocked] = useState(true);
  const [announce, setAnnounce] = useState(false);
  return (
    <>
      <PageIntro
        description="Labels stay visible, descriptions and errors are wired to the control, and validation states come from the field."
        title="Forms"
      />
      <Specimen title="Text field">
        <Field
          description="Only visible on this device."
          label="Workspace name"
        >
          <Input defaultValue="Personal" />
        </Field>
        <Field label="Vault passphrase">
          <Input placeholder="At least 12 characters" secureTextEntry />
        </Field>
        <Field
          error="The Workspace identity is not recognized."
          label="Invalid value"
        >
          <Input defaultValue="not-an-identity" invalid />
        </Field>
        <Field label="Read-only">
          <Input defaultValue="workspace_9f3ac21b" readOnly />
        </Field>
        <Field label="Disabled">
          <Input editable={false} placeholder="Unavailable while locked" />
        </Field>
      </Specimen>
      <Specimen title="Switch">
        <Switch
          description="Keep the vault unlocked while the app stays open."
          label="Stay unlocked"
          onValueChange={setStayUnlocked}
          value={stayUnlocked}
        />
        <Switch
          description="Publish presence to peers on this network."
          label="Announce to peers"
          onValueChange={setAnnounce}
          value={announce}
        />
        <Switch
          description="Unavailable until a Workspace exists."
          disabled
          label="Background sync"
          value={false}
        />
      </Specimen>
    </>
  );
}

const alertCopy = {
  neutral: {
    title: 'Heads up',
    body: 'The daemon endpoint changed; peers will reconnect automatically.',
  },
  success: {
    title: 'Workspace created',
    body: 'Personal is ready and its identity is registered locally.',
  },
  warning: {
    title: 'Stale endpoint',
    body: 'Lode replaced a stale daemon endpoint from a previous session.',
  },
  destructive: {
    title: 'Unable to start',
    body: 'The daemon lock is held by another process. The Home stays untouched.',
  },
} as const;

export function StatusPage() {
  return (
    <>
      <PageIntro
        description="Status always carries a text label; color only reinforces it. Alerts own page-level feedback, badges own inline state."
        title="Status"
      />
      <Specimen title="Badges">
        <View style={styles.wrapRow}>
          {badgeTones.map(tone => (
            <Badge dot key={tone} tone={tone}>
              {capitalize(tone)}
            </Badge>
          ))}
        </View>
      </Specimen>
      <Specimen title="Alerts">
        {alertTones.map(tone => (
          <Alert key={tone} title={alertCopy[tone].title} tone={tone}>
            {alertCopy[tone].body}
          </Alert>
        ))}
      </Specimen>
      <Specimen title="Progress">
        <View style={styles.wrapRow}>
          <Spinner />
          <Button loading variant="secondary">
            Restoring index
          </Button>
        </View>
      </Specimen>
    </>
  );
}

export function SurfacesPage() {
  return (
    <>
      <PageIntro
        description="Cards structure a page; the theme provider flips a whole region between paper and night without new components."
        title="Surfaces"
      />
      <Specimen title="Card">
        <Card>
          <CardTitle>Actors and Workspaces</CardTitle>
          <CardDescription>
            Everything this Home owns, kept on hardware you control.
          </CardDescription>
          <View style={styles.cardActions}>
            <Button size="sm" variant="outline">
              Review
            </Button>
            <Button size="sm" variant="ghost">
              Dismiss
            </Button>
          </View>
        </Card>
      </Specimen>
      <Specimen
        description="Status communicated by a badge inside a card."
        title="Composition"
      >
        <Card>
          <View style={styles.cardHeading}>
            <CardTitle>Engine online</CardTitle>
            <Badge dot tone="success">
              Ready
            </Badge>
          </View>
          <CardDescription>
            Rendered by the exact same Button, Badge, and Card.
          </CardDescription>
          <View style={styles.cardActions}>
            <Button size="sm">Create Workspace</Button>
          </View>
        </Card>
      </Specimen>
    </>
  );
}

const styles = StyleSheet.create({
  wrapRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.space.sm,
  },
  cardActions: {
    flexDirection: 'row',
    gap: tokens.space.sm,
    marginTop: tokens.space.md,
  },
  cardHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: tokens.space.sm,
    justifyContent: 'space-between',
  },
});
