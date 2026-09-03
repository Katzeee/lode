import { useState } from "react";

import { Button } from "../components/button.js";
import { ContextMenu } from "../components/context-menu.js";
import { AlertDialog, Dialog } from "../components/dialog.js";
import { DropdownMenu, type DropdownMenuItem } from "../components/dropdown-menu.js";
import { Popover } from "../components/popover.js";
import { Field, FieldLabel } from "../components/field.js";
import { Icon } from "../components/icon.js";
import { Input } from "../components/input.js";
import { toast } from "../components/toast.js";
import { Tooltip } from "../components/tooltip.js";
import { PageIntro, Specimen } from "./specimen.js";

export function OverlaysPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const menuItems: readonly DropdownMenuItem[] = [
    {
      icon: "copy",
      label: "Copy Workspace identity",
      onSelect: () => toast({ title: "Workspace identity copied", tone: "success" }),
    },
    {
      icon: "pencil",
      label: "Rename",
      onSelect: () => setDialogOpen(true),
    },
    {
      icon: "trash",
      label: "Delete",
      onSelect: () => setAlertOpen(true),
      tone: "destructive",
    },
  ];
  return (
    <>
      <PageIntro
        description="Overlays preserve focus, keyboard behavior, touch ergonomics, and motion policy so product screens only provide intent and content."
        title="Overlays"
      />
      <Specimen
        description="Lucide names and sizing semantics are shared with the mobile component layer."
        title="Icons"
      >
        <Icon label="Copy" name="copy" />
        <Icon label="Edit" name="pencil" />
        <Icon label="Delete" name="trash" />
        <Icon label="Success" name="check" />
      </Specimen>
      <Specimen
        description="Dialog traps focus and closes on Escape. AlertDialog requires an explicit response and uses the destructive action hierarchy."
        title="Dialog & AlertDialog"
      >
        <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
        <Button onClick={() => setAlertOpen(true)} variant="destructive">
          Delete Workspace
        </Button>
        <Dialog
          actions={[
            { label: "Cancel" },
            {
              label: "Save changes",
              onPress: () => toast({ title: "Workspace renamed", tone: "success" }),
              variant: "primary",
            },
          ]}
          description="Update the label shown on this device. The Workspace identity does not change."
          onOpenChange={setDialogOpen}
          open={dialogOpen}
          title="Rename Workspace"
        >
          <Field>
            <FieldLabel>Workspace label</FieldLabel>
            <Input defaultValue="Personal knowledge base" name="workspace-label" />
          </Field>
        </Dialog>
        <AlertDialog
          confirmLabel="Delete Workspace"
          description="Local Workspace data is removed from this Home. This action cannot be undone."
          onConfirm={() => toast({ title: "Workspace deleted", tone: "destructive" })}
          onOpenChange={setAlertOpen}
          open={alertOpen}
          title="Delete this Workspace?"
        />
      </Specimen>
      <Specimen description="Menu items accept the same icon names and a destructive tone." title="Dropdown menu">
        <DropdownMenu items={menuItems} label="Workspace actions" />
      </Specimen>
      <Specimen
        description="Right-click on desktop, long-press on touch. The same items as DropdownMenu, anchored to the pointer."
        title="Context menu"
      >
        <ContextMenu items={menuItems}>
          <div className="grid h-24 w-full max-w-105 place-items-center rounded-md border border-dashed border-input text-label text-muted-foreground select-none">
            Right-click or long-press this node
          </div>
        </ContextMenu>
      </Specimen>
      <Specimen
        description="A Popover holds light, non-blocking content anchored to its trigger; anything modal belongs in a Dialog."
        title="Popover"
      >
        <Popover title="Sync details" trigger={<Button variant="outline">Sync status</Button>}>
          <p className="text-caption text-muted-foreground">
            Last reconciled 2 minutes ago. 3 peers hold this Workspace; every fact is durable locally.
          </p>
        </Popover>
      </Specimen>
      <Specimen
        description="Hover and keyboard focus reveal concise hints. The same copy action stays available in Workspace actions on touch."
        title="Tooltip"
      >
        <Tooltip content="Copy Workspace identity">
          <Button
            aria-label="Copy Workspace identity"
            onClick={() => toast({ title: "Workspace identity copied", tone: "success" })}
            size="icon"
            variant="outline"
          >
            <Icon name="copy" />
          </Button>
        </Tooltip>
      </Specimen>
      <Specimen
        description="Toasts stack, dismiss automatically, announce by priority, and may expose one concise action."
        title="Toast"
      >
        <Button onClick={() => toast({ description: "All local changes are durable.", title: "Workspace saved" })}>
          Show toast
        </Button>
        <Button
          onClick={() =>
            toast({
              action: { label: "Retry", onPress: () => toast({ title: "Retrying connection" }) },
              description: "The peer did not respond.",
              title: "Connection failed",
              tone: "destructive",
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
        <p className="text-body text-muted-foreground">
          One transition contract covers dialogs, menus, tooltips, and toasts.
        </p>
      </Specimen>
    </>
  );
}
