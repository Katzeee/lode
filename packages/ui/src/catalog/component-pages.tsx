import { alertTones, badgeTones, buttonSizes, buttonVariants } from "@lode/design-system-catalog";
import { useState } from "react";

import { Alert, AlertTitle } from "../components/alert.js";
import { Badge, BadgeDot } from "../components/badge.js";
import { Button } from "../components/button.js";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/card.js";
import { Field, FieldDescription, FieldLabel } from "../components/field.js";
import { Input } from "../components/input.js";
import { Spinner } from "../components/spinner.js";
import { Switch } from "../components/switch.js";
import { Textarea } from "../components/textarea.js";
import { useCatalogMode } from "./catalog-theme.js";
import { PageIntro, Specimen } from "./specimen.js";

export function ButtonsPage() {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageIntro
        description="One action hierarchy for every surface. Hover, focus, busy, and disabled states come from the component, never from screens."
        title="Buttons"
      />
      <Specimen description="Exactly one primary action per view." title="Variants">
        {buttonVariants.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant.charAt(0).toUpperCase() + variant.slice(1)}
          </Button>
        ))}
      </Specimen>
      <Specimen title="Sizes">
        {buttonSizes.map((size) => (
          <Button key={size} size={size} variant="secondary">
            Size {size}
          </Button>
        ))}
      </Specimen>
      <Specimen description="A busy button announces itself and blocks re-entry." title="States">
        <Button
          loading={busy}
          onClick={() => {
            setBusy(true);
            window.setTimeout(() => setBusy(false), 1600);
          }}
        >
          {busy ? "Working…" : "Click to load"}
        </Button>
        <Button disabled>Disabled</Button>
        <Button loading variant="outline">
          Saving
        </Button>
      </Specimen>
    </>
  );
}

export function FormsPage() {
  return (
    <>
      <PageIntro
        description="Labels stay visible, descriptions and errors are wired to the control, and validation states come from the field."
        title="Forms"
      />
      <Specimen className="max-w-105 flex-col flex-nowrap items-stretch gap-5" title="Text field">
        <Field>
          <FieldLabel>Workspace name</FieldLabel>
          <Input defaultValue="Personal" name="workspace" />
          <FieldDescription>Only visible on this device.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Vault passphrase</FieldLabel>
          <Input name="passphrase" placeholder="At least 12 characters" type="password" />
        </Field>
        <Field>
          <FieldLabel>Invalid value</FieldLabel>
          <Input aria-invalid defaultValue="not-an-identity" name="identity" />
          <p className="text-caption font-medium text-destructive">The Workspace identity is not recognized.</p>
        </Field>
        <Field>
          <FieldLabel>Read-only</FieldLabel>
          <Input defaultValue="workspace_9f3ac21b" name="readonly" readOnly />
        </Field>
        <Field>
          <FieldLabel>Disabled</FieldLabel>
          <Input disabled name="disabled" placeholder="Unavailable while locked" />
        </Field>
        <Field>
          <FieldLabel>Workspace description</FieldLabel>
          <Textarea name="description" placeholder="What belongs in this Workspace?" rows={4} />
          <FieldDescription>Use a multiline field for notes and other prose input.</FieldDescription>
        </Field>
      </Specimen>
      <Specimen className="max-w-105 flex-col flex-nowrap items-stretch gap-4" title="Switch">
        <SwitchRow
          defaultChecked
          description="Keep the vault unlocked while this window stays open."
          label="Stay unlocked"
        />
        <SwitchRow description="Publish presence to peers on this network." label="Announce to peers" />
        <SwitchRow disabled description="Unavailable until a Workspace exists." label="Background sync" />
      </Specimen>
    </>
  );
}

function SwitchRow(
  properties: Readonly<{ defaultChecked?: boolean; description: string; disabled?: boolean; label: string }>,
) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="flex min-w-0 flex-col flex-nowrap gap-0.5">
        <span className="text-label font-medium">{properties.label}</span>
        <span className="text-caption text-muted-foreground">{properties.description}</span>
      </span>
      <Switch defaultChecked={properties.defaultChecked} disabled={properties.disabled} />
    </label>
  );
}

export function StatusPage() {
  return (
    <>
      <PageIntro
        description="Status always carries a text label; color only reinforces it. Alerts own page-level feedback, badges own inline state."
        title="Status"
      />
      <Specimen title="Badges">
        {badgeTones.map((tone) => (
          <Badge key={tone} tone={tone}>
            <BadgeDot />
            {tone.charAt(0).toUpperCase() + tone.slice(1)}
          </Badge>
        ))}
      </Specimen>
      <Specimen className="flex-col flex-nowrap items-stretch" title="Alerts">
        {alertTones.map((tone) => (
          <Alert key={tone} tone={tone}>
            <AlertTitle>{alertCopy[tone].title}</AlertTitle>
            {alertCopy[tone].body}
          </Alert>
        ))}
      </Specimen>
      <Specimen title="Progress">
        <Spinner className="text-primary" label="Loading" />
        <Button loading variant="secondary">
          Restoring index
        </Button>
      </Specimen>
    </>
  );
}

const alertCopy = {
  neutral: { title: "Heads up", body: "The daemon endpoint changed; peers will reconnect automatically." },
  success: { title: "Workspace created", body: "Personal is ready and its identity is registered locally." },
  warning: { title: "Stale endpoint", body: "Lode replaced a stale daemon endpoint from a previous session." },
  destructive: {
    title: "Unable to start",
    body: "The daemon lock is held by another process. The Home stays untouched.",
  },
} as const;

export function SurfacesPage() {
  const mode = useCatalogMode();
  const opposite = mode === "light" ? "dark" : "light";
  return (
    <>
      <PageIntro
        description="Cards structure a page; a data-mode boundary flips a whole region between paper and night without new components."
        title="Surfaces"
      />
      <Specimen className="items-stretch" title="Card">
        <Card className="max-w-105 flex-1">
          <CardHeader>
            <CardTitle>Actors and Workspaces</CardTitle>
            <CardDescription>Everything this Home owns, kept on hardware you control.</CardDescription>
          </CardHeader>
          <CardContent className="text-body text-muted-foreground">
            Two Actors, one shared Workspace index, and a vault that unlocks per session.
          </CardContent>
          <CardFooter>
            <Button size="sm" variant="outline">
              Review
            </Button>
            <Button size="sm" variant="ghost">
              Dismiss
            </Button>
          </CardFooter>
        </Card>
      </Specimen>
      <Specimen
        description={`The same components, scoped with data-mode="${opposite}" inside the ${mode} catalog.`}
        title="Theme boundary"
      >
        <div
          className="max-w-105 flex-1 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-md"
          data-mode={opposite}
        >
          <p className="mb-2 text-caption font-semibold tracking-widest text-primary uppercase">Engine online</p>
          <h3 className="text-title-small font-medium">Create another Workspace</h3>
          <p className="mt-1 mb-4 text-body text-muted-foreground">Rendered by the exact same Button and Badge.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Create Workspace</Button>
            <Badge tone="success">
              <BadgeDot />
              Ready
            </Badge>
          </div>
        </div>
      </Specimen>
    </>
  );
}
