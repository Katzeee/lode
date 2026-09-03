import { StyleSheet, View } from 'react-native';
import { tokens } from '@lode/design-tokens';

import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { Card, CardDescription, CardTitle } from '../ui/card';
import { Text } from '../ui/text';
import { PageIntro, Specimen } from './specimen';

export function ContentPage() {
  return (
    <>
      <PageIntro
        description="Interface copy names the current state, explains what the person can do, and uses the same vocabulary as the product domain."
        title="Content"
      />
      <Specimen
        description="State the problem in sentence case, then give a concrete recovery action. Use a period for complete sentences."
        title="Errors point to recovery"
      >
        <Alert tone="destructive">
          The passphrase does not unlock this vault. Check the passphrase and
          try again.
        </Alert>
      </Specimen>
      <Specimen
        description="Name what is missing and pair it with the action that creates the first item."
        title="Empty states lead somewhere"
      >
        <Card>
          <CardTitle>No workspaces yet</CardTitle>
          <CardDescription>
            Create a workspace to organize documents and invite collaborators.
          </CardDescription>
          <View style={styles.action}>
            <Button>Create workspace</Button>
          </View>
        </Card>
      </Specimen>
      <Specimen
        description="Buttons use a specific verb and object. Avoid Submit, Yes, and OK when the actual outcome has a name."
        title="Actions say what happens"
      >
        <View style={styles.buttons}>
          <Button>Create workspace</Button>
          <Button variant="outline">Export recovery phrase</Button>
          <Button variant="destructive">Delete workspace</Button>
        </View>
      </Specimen>
      <Specimen
        description="Headings, labels, buttons, and messages use sentence case. Preserve official acronyms and product names such as Lode, SQLite, and API."
        title="Casing follows natural language"
      >
        <Text variant="title-small" weight="semibold">
          Connect local storage
        </Text>
        <Text color="muted-foreground">
          SQLite keeps authoritative data on this device.
        </Text>
      </Specimen>
    </>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'flex-start', marginTop: tokens.space.lg },
  buttons: { alignItems: 'stretch', gap: tokens.space.sm },
});
