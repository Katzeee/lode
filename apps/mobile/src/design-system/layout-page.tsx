import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { tokens } from '@lode/design-tokens';

import { Button } from '../ui/button';
import { ListDetail } from '../ui/list-detail';
import { Text } from '../ui/text';
import { PageIntro, Specimen } from './specimen';

const workspaces = [
  {
    id: 'field-notes',
    name: 'Field notes',
    summary: '12 documents · updated today',
  },
  {
    id: 'research',
    name: 'Research',
    summary: '8 documents · updated yesterday',
  },
  {
    id: 'archive',
    name: 'Archive',
    summary: '31 documents · updated last week',
  },
] as const;

export function LayoutPage() {
  const [selectedId, setSelectedId] = useState<
    (typeof workspaces)[number]['id'] | null
  >(null);
  const selected =
    workspaces.find(({ id }) => id === selectedId) ?? workspaces[0];
  return (
    <>
      <PageIntro
        description="AppShell chooses bottom navigation, an icon rail, or a full sidebar from the window width. PageScaffold supplies the shared header, actions, content width, and safe gutter."
        title="Responsive layouts"
      />
      <Specimen
        description="Compact windows push from the list into a detail view. Expanded windows keep both panes visible, so the same state model works at every size."
        title="List and detail"
      >
        <ListDetail
          detail={
            <View style={styles.detail}>
              <Text color="primary" variant="caption" weight="semibold">
                WORKSPACE
              </Text>
              <Text variant="title" weight="semibold">
                {selected.name}
              </Text>
              <Text color="muted-foreground">{selected.summary}</Text>
              <Text style={styles.detailCopy}>
                Documents, members, and recent activity belong here. Selecting
                another workspace updates this pane without changing the layout
                contract.
              </Text>
            </View>
          }
          detailVisible={selectedId !== null}
          list={
            <View style={styles.list}>
              {workspaces.map(workspace => (
                <Button
                  key={workspace.id}
                  onPress={() => setSelectedId(workspace.id)}
                  variant={workspace.id === selected.id ? 'secondary' : 'ghost'}
                >
                  {workspace.name}
                </Button>
              ))}
            </View>
          }
          onBack={() => setSelectedId(null)}
        />
      </Specimen>
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: tokens.space['2xs'], padding: tokens.space.sm },
  detail: { gap: tokens.space.xs, padding: tokens.space.lg },
  detailCopy: { marginTop: tokens.space.md },
});
