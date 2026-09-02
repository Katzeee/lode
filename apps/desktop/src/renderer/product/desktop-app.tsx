import { useEffect, useState } from "react";

import type { DesktopBridge, DesktopState } from "../../bridge/contract.cjs";
import { ActionPanel } from "./action-panel.js";
import { authorityText, shortIdentity } from "./desktop-state-presentation.js";
import { Alert } from "../ui/alert.js";
import { Badge, BadgeDot } from "../ui/badge.js";
import { Card, CardHeader, CardTitle } from "../ui/card.js";

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

  return (
    <main
      className="@container mx-auto flex min-h-screen w-full max-w-280 flex-col px-6 pb-14 @3xl:px-10"
      data-phase={state.phase}
    >
      <Topbar authority={state.authority} />

      <section
        className="grid items-end gap-10 py-12 @3xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]"
        id="main-panel"
      >
        <div>
          <p className="mb-3 text-caption font-semibold tracking-widest text-primary uppercase">
            Local knowledge, one authority
          </p>
          <h1 className="text-display font-medium tracking-tight text-balance" data-testid="phase">
            {state.headline}
          </h1>
          <p className="mt-4 max-w-165 text-body-large text-muted-foreground">{state.detail}</p>
        </div>
        <HomeIdentity state={state} />
      </section>

      {state.notice === null ? null : (
        <Alert className="mb-8" data-testid="notice" tone="warning">
          {state.notice}
        </Alert>
      )}
      {state.error === null ? null : (
        <Alert className="mb-8" data-testid="error" tone="destructive">
          {state.error}
        </Alert>
      )}

      <section className="grid flex-1 items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
        <Card className="p-7 shadow-md @3xl:p-8">
          <ActionPanel bridge={bridge} state={state} setState={setState} />
        </Card>
        <Inventory state={state} />
      </section>
    </main>
  );
}

function Topbar({ authority }: Readonly<{ authority: DesktopState["authority"] }>) {
  const healthy = authority === "owned" || authority === "reused";
  return (
    <header className="flex min-h-20 items-center justify-between gap-4 border-b border-border">
      <a
        aria-label="Lode home"
        className="flex items-center gap-2.5 text-body-large font-bold tracking-tight"
        href="#main-panel"
      >
        <span className="grid size-8 place-items-center rounded-sm bg-primary text-label font-bold text-primary-foreground">
          L
        </span>
        Lode
      </a>
      <nav className="flex min-w-0 items-center gap-1.5">
        <TopbarLink href="#/design-system">Design system</TopbarLink>
        <TopbarLink href="#/legal">Legal</TopbarLink>
        <Badge className="min-w-0" data-testid="authority" tone={healthy ? "success" : "warning"}>
          <BadgeDot />
          <span className="truncate">{authorityText(authority)}</span>
        </Badge>
      </nav>
    </header>
  );
}

function TopbarLink({ children, href }: Readonly<{ children: string; href: string }>) {
  return (
    <a
      className="hidden rounded-sm px-2.5 py-1.5 text-label font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground @2xl:inline-block"
      href={href}
    >
      {children}
    </a>
  );
}

function HomeIdentity({ state }: Readonly<{ state: DesktopState }>) {
  return (
    <Card className="shadow-xs">
      <dl className="grid grid-cols-3 divide-x divide-border">
        <IdentityStat label="Home" value={state.home?.name ?? "Preparing…"} />
        <IdentityStat label="Actors" testId="actor-count" value={String(state.actors.length)} />
        <IdentityStat label="Workspaces" testId="workspace-count" value={String(state.workspaces.length)} />
      </dl>
    </Card>
  );
}

function IdentityStat({ label, testId, value }: Readonly<{ label: string; testId?: string; value: string }>) {
  return (
    <div className="min-w-0 px-4 py-4">
      <dt className="text-caption font-medium tracking-widest text-muted-foreground uppercase">{label}</dt>
      <dd className="m-0 mt-1 truncate text-body-large font-semibold" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function Inventory({ state }: Readonly<{ state: DesktopState }>) {
  return (
    <Card>
      <CardHeader>
        <p className="text-caption font-semibold tracking-widest text-primary uppercase">Local inventory</p>
        <CardTitle>Actors and Workspaces</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-5 p-6">
        <InventorySection empty="No Actor exists yet." isEmpty={state.actors.length === 0} title="Actors">
          {state.actors.map((actor) => (
            <li
              className="flex items-center justify-between gap-4 py-2.5"
              data-actor-id={actor.actorId}
              key={actor.actorId}
            >
              <span className="truncate font-medium">{actor.label}</span>
              <Badge tone={actor.unlocked ? "success" : "neutral"}>{actor.unlocked ? "Unlocked" : "Locked"}</Badge>
            </li>
          ))}
        </InventorySection>
        <InventorySection empty="No Workspace exists yet." isEmpty={state.workspaces.length === 0} title="Workspaces">
          {state.workspaces.map((workspace) => (
            <li
              className="flex items-center justify-between gap-4 py-2.5"
              data-workspace-id={workspace.workspaceId}
              key={workspace.workspaceId}
            >
              <span className="truncate font-medium">{workspace.label}</span>
              <span className="font-mono text-caption text-muted-foreground" title={workspace.workspaceId}>
                {shortIdentity(workspace.workspaceId)}
              </span>
            </li>
          ))}
        </InventorySection>
      </div>
    </Card>
  );
}

function InventorySection({
  children,
  empty,
  isEmpty,
  title,
}: Readonly<{ children: React.ReactNode; empty: string; isEmpty: boolean; title: string }>) {
  return (
    <section>
      <h3 className="mb-1 text-caption font-medium tracking-widest text-muted-foreground uppercase">{title}</h3>
      {isEmpty ? (
        <p className="py-2 text-body text-muted-foreground">{empty}</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-border p-0">{children}</ul>
      )}
    </section>
  );
}
