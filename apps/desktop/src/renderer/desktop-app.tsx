import { useEffect, useState, type FormEvent } from "react";

import type { DesktopBridge, DesktopState } from "../bridge/contract.cjs";

const bootState: DesktopState = {
  phase: "initializing",
  headline: "Initializing Lode",
  detail: "Opening the packaged desktop shell.",
  home: null,
  authority: "none",
  actors: [],
  workspaces: [],
  notice: null,
  error: null,
};

export function DesktopApp({ bridge }: Readonly<{ bridge: DesktopBridge }>) {
  const [state, setState] = useState(bootState);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = bridge.onStateChanged((next) => {
      if (active) {
        setState(next);
      }
    });
    void bridge.getState().then((next) => {
      if (active) {
        setState(next);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  const authorityLabel = authorityText(state.authority);
  return (
    <main className="shell" data-phase={state.phase}>
      <header className="topbar">
        <a className="brand" href="#main-panel" aria-label="Lode home">
          <span className="brand-mark">L</span>
          <span>Lode</span>
        </a>
        <span className={`authority authority-${state.authority}`} data-testid="authority">
          <span aria-hidden="true" className="status-dot" />
          {authorityLabel}
        </span>
      </header>

      <section className="hero" id="main-panel">
        <div>
          <p className="eyebrow">Local knowledge, one authority</p>
          <h1 data-testid="phase">{state.headline}</h1>
          <p className="lede">{state.detail}</p>
        </div>
        <HomeIdentity state={state} />
      </section>

      {state.notice === null ? null : (
        <p className="notice" data-testid="notice">
          {state.notice}
        </p>
      )}
      {state.error === null ? null : (
        <p className="error" role="alert" data-testid="error">
          {state.error}
        </p>
      )}

      <section className="content-grid">
        <article className="panel action-panel">
          <StateAction bridge={bridge} state={state} setState={setState} onRecoveryPhrase={setRecoveryPhrase} />
          {recoveryPhrase === null ? null : (
            <div className="recovery" data-testid="recovery-phrase">
              <strong>Recovery phrase</strong>
              <p>{recoveryPhrase}</p>
              <small>Store this phrase somewhere private. Lode does not show it again.</small>
            </div>
          )}
        </article>

        <article className="panel inventory-panel">
          <Inventory state={state} />
        </article>
      </section>
    </main>
  );
}

function HomeIdentity({ state }: Readonly<{ state: DesktopState }>) {
  return (
    <dl className="home-identity">
      <div>
        <dt>Home</dt>
        <dd>{state.home?.name ?? "Preparing…"}</dd>
      </div>
      <div>
        <dt>Actors</dt>
        <dd data-testid="actor-count">{state.actors.length}</dd>
      </div>
      <div>
        <dt>Workspaces</dt>
        <dd data-testid="workspace-count">{state.workspaces.length}</dd>
      </div>
    </dl>
  );
}

type ActionProperties = Readonly<{
  bridge: DesktopBridge;
  state: DesktopState;
  setState(state: DesktopState): void;
  onRecoveryPhrase(value: string): void;
}>;

function StateAction(properties: ActionProperties) {
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

function InitializeForm({ bridge, setState, onRecoveryPhrase }: ActionProperties) {
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const result = await bridge.initializeHome({
        actorLabel: formText(data, "actorLabel"),
        passphrase: formText(data, "passphrase"),
        workspaceLabel: formText(data, "workspaceLabel"),
      });
      onRecoveryPhrase(result.recoveryPhrase);
      setState(result.state);
    } catch {
      setState(await bridge.getState());
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)}>
      <p className="section-label">New Home</p>
      <h2>Create your local identity</h2>
      <Field label="Actor name" name="actorLabel" autoComplete="name" defaultValue="Local Actor" />
      <Field label="Vault passphrase" name="passphrase" type="password" autoComplete="new-password" />
      <Field label="First Workspace" name="workspaceLabel" defaultValue="Personal" />
      <button disabled={busy} type="submit">
        {busy ? "Creating…" : "Initialize Home"}
      </button>
    </form>
  );
}

function UnlockForm({ bridge, setState }: ActionProperties) {
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      setState(await bridge.unlockVault(formText(data, "passphrase")));
    } catch {
      setState(await bridge.getState());
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)}>
      <p className="section-label">Welcome back</p>
      <h2>Unlock the Actor Vault</h2>
      <p>Your Workspace index is available; the passphrase unlocks signing identity for changes.</p>
      <Field label="Vault passphrase" name="passphrase" type="password" autoComplete="current-password" />
      <button disabled={busy} type="submit">
        {busy ? "Unlocking…" : "Unlock Vault"}
      </button>
    </form>
  );
}

function WorkspaceForm({ bridge, setState }: ActionProperties) {
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      setState(await bridge.createWorkspace(formText(data, "workspaceLabel")));
      form.reset();
    } catch {
      setState(await bridge.getState());
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)}>
      <p className="section-label">Engine online</p>
      <h2>Create another Workspace</h2>
      <p>The desktop shell reaches the same Engine application contract used by other local clients.</p>
      <Field label="Workspace name" name="workspaceLabel" />
      <button disabled={busy} type="submit">
        {busy ? "Creating…" : "Create Workspace"}
      </button>
    </form>
  );
}

function Inventory({ state }: Readonly<{ state: DesktopState }>) {
  return (
    <>
      <p className="section-label">Local inventory</p>
      <h2>Actors and Workspaces</h2>
      <h3>Actors</h3>
      {state.actors.length === 0 ? <p className="empty">No Actor exists yet.</p> : null}
      <ul>
        {state.actors.map((actor) => (
          <li key={actor.actorId} data-actor-id={actor.actorId}>
            <span>{actor.label}</span>
            <small>{actor.unlocked ? "unlocked" : "locked"}</small>
          </li>
        ))}
      </ul>
      <h3>Workspaces</h3>
      {state.workspaces.length === 0 ? <p className="empty">No Workspace exists yet.</p> : null}
      <ul>
        {state.workspaces.map((workspace) => (
          <li key={workspace.workspaceId} data-workspace-id={workspace.workspaceId}>
            <span>{workspace.label}</span>
            <small title={workspace.workspaceId}>{shortIdentity(workspace.workspaceId)}</small>
          </li>
        ))}
      </ul>
    </>
  );
}

function Field(
  properties: Readonly<{
    label: string;
    name: string;
    type?: "text" | "password";
    autoComplete?: string;
    defaultValue?: string;
  }>,
) {
  return (
    <label>
      <span>{properties.label}</span>
      <input
        autoComplete={properties.autoComplete}
        defaultValue={properties.defaultValue}
        maxLength={properties.type === "password" ? 512 : 120}
        name={properties.name}
        required
        type={properties.type ?? "text"}
      />
    </label>
  );
}

function LoadingAuthority() {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <div>
        <h2>Starting the local Engine</h2>
        <p>Lode is authenticating the selected Home and waiting for daemon Status.</p>
      </div>
    </div>
  );
}

function ErrorGuidance() {
  return (
    <div>
      <p className="section-label">Host error</p>
      <h2>The Home stays untouched</h2>
      <p>Close Lode, resolve the reported Home or daemon problem, and start the packaged application again.</p>
    </div>
  );
}

function authorityText(authority: DesktopState["authority"]): string {
  switch (authority) {
    case "none":
      return "Authority pending";
    case "starting":
      return "Connecting";
    case "owned":
      return "Desktop-owned daemon";
    case "reused":
      return "Shared daemon";
  }
}

function shortIdentity(identity: string): string {
  return identity.length <= 14 ? identity : `${identity.slice(0, 6)}…${identity.slice(-6)}`;
}

function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
