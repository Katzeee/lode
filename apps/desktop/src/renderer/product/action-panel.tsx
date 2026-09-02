import { useState, type FormEvent, type ReactNode } from "react";

import type { DesktopBridge, DesktopState } from "../../bridge/contract.cjs";
import { Button } from "../ui/button.js";
import { Field, FieldLabel } from "../ui/field.js";
import { Input } from "../ui/input.js";
import { Spinner } from "../ui/spinner.js";

type ActionProperties = Readonly<{
  bridge: DesktopBridge;
  state: DesktopState;
  setState(state: DesktopState): void;
}>;

export function ActionPanel(properties: ActionProperties) {
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  return (
    <>
      <StateAction {...properties} onRecoveryPhrase={setRecoveryPhrase} />
      {recoveryPhrase === null ? null : (
        <div className="mt-6 rounded-md border border-primary/25 bg-primary/10 p-4" data-testid="recovery-phrase">
          <strong className="text-label font-semibold">Recovery phrase</strong>
          <p className="my-2 font-mono text-caption wrap-anywhere">{recoveryPhrase}</p>
          <small className="text-caption text-muted-foreground">
            Store this phrase somewhere private. Lode does not show it again.
          </small>
        </div>
      )}
    </>
  );
}

type StateActionProperties = ActionProperties & Readonly<{ onRecoveryPhrase(value: string): void }>;

function StateAction(properties: StateActionProperties) {
  if (properties.state.phase === "error") {
    return <ErrorGuidance />;
  }
  if (properties.state.authority === "none" || properties.state.authority === "starting") {
    return <LoadingAuthority />;
  }
  if (properties.state.phase === "initializing") {
    return <InitializeForm {...properties} />;
  }
  if (properties.state.phase === "locked") {
    return <UnlockForm {...properties} />;
  }
  return <WorkspaceForm {...properties} />;
}

function PanelIntro({
  children,
  headline,
  label,
}: Readonly<{ children?: ReactNode; headline: string; label: string }>) {
  return (
    <>
      <p className="mb-3 text-caption font-semibold tracking-widest text-primary uppercase">{label}</p>
      <h2 className="text-title font-medium tracking-tight">{headline}</h2>
      {children === undefined ? null : <p className="mt-2 text-body text-muted-foreground">{children}</p>}
    </>
  );
}

function TextField(
  properties: Readonly<{
    autoComplete?: string;
    defaultValue?: string;
    label: string;
    name: string;
    type?: "text" | "password";
  }>,
) {
  return (
    <Field>
      <FieldLabel>{properties.label}</FieldLabel>
      <Input
        autoComplete={properties.autoComplete}
        defaultValue={properties.defaultValue}
        maxLength={properties.type === "password" ? 512 : 120}
        name={properties.name}
        required
        type={properties.type ?? "text"}
      />
    </Field>
  );
}

function useSubmit(action: (data: FormData, form: HTMLFormElement) => Promise<void>, fallback: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    try {
      await action(new FormData(form), form);
    } catch {
      await fallback();
    } finally {
      setBusy(false);
    }
  };
  return { busy, onSubmit: (event: FormEvent<HTMLFormElement>) => void submit(event) };
}

function InitializeForm({ bridge, setState, onRecoveryPhrase }: StateActionProperties) {
  const { busy, onSubmit } = useSubmit(
    async (data) => {
      const result = await bridge.initializeHome({
        actorLabel: formText(data, "actorLabel"),
        passphrase: formText(data, "passphrase"),
        workspaceLabel: formText(data, "workspaceLabel"),
      });
      onRecoveryPhrase(result.recoveryPhrase);
      setState(result.state);
    },
    async () => setState(await bridge.getState()),
  );
  return (
    <form className="flex flex-col" onSubmit={onSubmit}>
      <PanelIntro headline="Create your local identity" label="New Home" />
      <div className="mt-6 flex flex-col gap-5">
        <TextField autoComplete="name" defaultValue="Local Actor" label="Actor name" name="actorLabel" />
        <TextField autoComplete="new-password" label="Vault passphrase" name="passphrase" type="password" />
        <TextField defaultValue="Personal" label="First Workspace" name="workspaceLabel" />
      </div>
      <Button className="mt-7 w-full" loading={busy} size="lg" type="submit">
        {busy ? "Creating…" : "Initialize Home"}
      </Button>
    </form>
  );
}

function UnlockForm({ bridge, setState }: StateActionProperties) {
  const { busy, onSubmit } = useSubmit(
    async (data) => setState(await bridge.unlockVault(formText(data, "passphrase"))),
    async () => setState(await bridge.getState()),
  );
  return (
    <form className="flex flex-col" onSubmit={onSubmit}>
      <PanelIntro headline="Unlock the Actor Vault" label="Welcome back">
        Your Workspace index is available; the passphrase unlocks signing identity for changes.
      </PanelIntro>
      <div className="mt-6 flex flex-col gap-5">
        <TextField autoComplete="current-password" label="Vault passphrase" name="passphrase" type="password" />
      </div>
      <Button className="mt-7 w-full" loading={busy} size="lg" type="submit">
        {busy ? "Unlocking…" : "Unlock Vault"}
      </Button>
    </form>
  );
}

function WorkspaceForm({ bridge, setState }: StateActionProperties) {
  const { busy, onSubmit } = useSubmit(
    async (data, form) => {
      setState(await bridge.createWorkspace(formText(data, "workspaceLabel")));
      form.reset();
    },
    async () => setState(await bridge.getState()),
  );
  return (
    <form className="flex flex-col" onSubmit={onSubmit}>
      <PanelIntro headline="Create another Workspace" label="Engine online">
        The desktop shell reaches the same Engine application contract used by other local clients.
      </PanelIntro>
      <div className="mt-6 flex flex-col gap-5">
        <TextField label="Workspace name" name="workspaceLabel" />
      </div>
      <Button className="mt-7 w-full" loading={busy} size="lg" type="submit">
        {busy ? "Creating…" : "Create Workspace"}
      </Button>
    </form>
  );
}

function LoadingAuthority() {
  return (
    <div className="flex min-h-44 items-center gap-5" role="status">
      <Spinner className="size-7 text-primary" />
      <div>
        <h2 className="text-title-small font-medium">Starting the local Engine</h2>
        <p className="mt-1 text-body text-muted-foreground">
          Lode is authenticating the selected Home and waiting for daemon Status.
        </p>
      </div>
    </div>
  );
}

function ErrorGuidance() {
  return (
    <div>
      <PanelIntro headline="The Home stays untouched" label="Host error">
        Close Lode, resolve the reported Home or daemon problem, and start the packaged application again.
      </PanelIntro>
    </div>
  );
}

function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
