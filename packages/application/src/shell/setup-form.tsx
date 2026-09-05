import { Alert, Button, Field, FieldLabel, Input, PageScaffold } from "@lode/ui";
import { useState, type FormEvent } from "react";
import type { ApplicationHost, ApplicationState } from "../session/contract.js";
export function SetupForm({
  host,
  state,
  onState,
  onRecovery,
}: Readonly<{
  host: ApplicationHost;
  state: ApplicationState;
  onState(state: ApplicationState): void;
  onRecovery(phrase: string): void;
}>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialize = state.phase === "initializing";
  const workspace = state.phase === "ready";
  const title = workspace ? "Create your workspace" : initialize ? "Welcome to Lode" : "Welcome back";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (initialize) {
        const result = await host.initialize({
          actorLabel: formText(data, "name"),
          passphrase: formText(data, "passphrase"),
        });
        onRecovery(result.recoveryPhrase);
        onState(result.state);
      } else {
        onState(
          await (workspace
            ? host.createWorkspace(formText(data, "workspace"))
            : host.unlock(formText(data, "passphrase"))),
        );
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PageScaffold
      title={title}
      description={
        workspace
          ? "A place for your notes, ideas and projects."
          : initialize
            ? "Create your identity to begin."
            : "Unlock your space to continue."
      }
    >
      <form className="flex max-w-sm flex-col gap-5" onSubmit={(event) => void submit(event)}>
        {initialize ? (
          <Field>
            <FieldLabel htmlFor="name">Your name</FieldLabel>
            <Input id="name" name="name" autoComplete="name" required maxLength={120} />
          </Field>
        ) : null}
        {workspace ? (
          <Field>
            <FieldLabel htmlFor="workspace">Workspace name</FieldLabel>
            <Input id="workspace" name="workspace" defaultValue="My workspace" required maxLength={120} />
          </Field>
        ) : (
          <Field>
            <FieldLabel htmlFor="passphrase">Passphrase</FieldLabel>
            <Input
              id="passphrase"
              name="passphrase"
              type="password"
              autoComplete={initialize ? "new-password" : "current-password"}
              minLength={8}
              maxLength={512}
              required
            />
          </Field>
        )}
        {error === null ? null : <Alert tone="destructive">{error}</Alert>}
        <Button type="submit" loading={busy}>
          {workspace ? "Create workspace" : initialize ? "Create identity" : "Unlock"}
        </Button>
      </form>
    </PageScaffold>
  );
}

function formText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
