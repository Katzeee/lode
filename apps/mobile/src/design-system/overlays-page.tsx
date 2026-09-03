import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '../ui/button';
import { AlertDialog, Dialog } from '../ui/dialog';
import { DropdownMenu, type DropdownMenuItem } from '../ui/dropdown-menu';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';
import { toast } from '../ui/toast';
import { PageIntro, Specimen } from './specimen';

export function OverlaysPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const menuItems: readonly DropdownMenuItem[] = [
    {
      icon: 'copy',
      label: 'Duplicate Workspace',
      onSelect: () => toast({ title: 'Workspace duplicated', tone: 'success' }),
    },
    {
      icon: 'pencil',
      label: 'Rename',
      onSelect: () => setDialogOpen(true),
    },
    {
      icon: 'trash',
      label: 'Delete',
      onSelect: () => setAlertOpen(true),
      tone: 'destructive',
    },
  ];
  return (
    <>
      <PageIntro
        description="Overlays preserve accessibility, touch ergonomics, and motion policy so product screens only provide intent and content."
        title="Overlays"
      />
      <Specimen
        description="Lucide names and sizing semantics are shared with the desktop component layer."
        title="Icons"
      >
        <View style={{ flexDirection: 'row' }}>
          <Icon label="Copy" name="copy" />
          <Icon label="Edit" name="pencil" />
          <Icon label="Delete" name="trash" />
          <Icon label="Success" name="check" />
        </View>
      </Specimen>
      <Specimen
        description="Dialog uses a native Modal. AlertDialog blocks outside dismissal and requires an explicit response."
        title="Dialog & AlertDialog"
      >
        <Button onPress={() => setDialogOpen(true)}>Open dialog</Button>
        <Button onPress={() => setAlertOpen(true)} variant="destructive">
          Delete Workspace
        </Button>
        <Dialog
          actions={[
            { label: 'Cancel' },
            {
              label: 'Save changes',
              onPress: () =>
                toast({ title: 'Workspace renamed', tone: 'success' }),
              variant: 'primary',
            },
          ]}
          description="Update the label shown on this device. The Workspace identity does not change."
          onOpenChange={setDialogOpen}
          open={dialogOpen}
          title="Rename Workspace"
        >
          <Text color="muted-foreground">Personal knowledge base</Text>
        </Dialog>
        <AlertDialog
          confirmLabel="Delete Workspace"
          description="Local Workspace data is removed from this Home. This action cannot be undone."
          onConfirm={() =>
            toast({ title: 'Workspace deleted', tone: 'destructive' })
          }
          onOpenChange={setAlertOpen}
          open={alertOpen}
          title="Delete this Workspace?"
        />
      </Specimen>
      <Specimen
        description="On touch, DropdownMenu becomes a bottom action panel. Items accept icons and a destructive tone."
        title="Dropdown menu"
      >
        <DropdownMenu items={menuItems} label="Workspace actions" />
      </Specimen>
      <Specimen
        description="Touch has no hover tooltip. Long-press and contextual actions belong in DropdownMenu."
        title="Touch guidance"
      >
        <Text color="muted-foreground">
          Controls keep visible labels or accessibility labels instead of
          hover-only hints.
        </Text>
      </Specimen>
      <Specimen
        description="Toasts stack, dismiss automatically, announce by priority, and may expose one concise action."
        title="Toast"
      >
        <Button
          onPress={() =>
            toast({
              description: 'All local changes are durable.',
              title: 'Workspace saved',
            })
          }
        >
          Show toast
        </Button>
        <Button
          onPress={() =>
            toast({
              action: {
                label: 'Retry',
                onPress: () => toast({ title: 'Retrying connection' }),
              },
              description: 'The peer did not respond.',
              title: 'Connection failed',
              tone: 'destructive',
            })
          }
          variant="outline"
        >
          Show actionable toast
        </Button>
      </Specimen>
      <Specimen
        description="Every overlay fades and scales with motion.duration.panel and the standard easing curve. Reduced-motion keeps the fade but removes scaling."
        title="Motion preset"
      >
        <Text color="muted-foreground">
          One transition contract covers dialogs, menus, and toasts.
        </Text>
      </Specimen>
    </>
  );
}
