import {
  Alert,
  AppShell,
  Badge,
  BadgeDot,
  Card,
  CardHeader,
  CardTitle,
  PageScaffold,
  type AppShellSection,
} from "@lode/ui";
import { useEffect, useState } from "react";

import type { DesktopBridge, DesktopState } from "../../bridge/contract.cjs";
import { ActionPanel } from "./action-panel.js";
import { authorityText, shortIdentity } from "./desktop-state-presentation.js";

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

const navigationSections: readonly AppShellSection[] = [
  {
    id: "primary",
    items: [
      { id: "product", icon: "house", label: "Home", target: "#/" },
      { id: "design-system", icon: "shapes", label: "Design system", target: "#/design-system" },
      { id: "legal", icon: "type", label: "Legal", target: "#/legal" },
    ],
  },
];

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

  const healthy = state.authority === "owned" || state.authority === "reused";
  return (
    <AppShell activeItemId="product" sections={navigationSections}>
      <PageScaffold
        actions={
          <Badge className="min-w-0" data-testid="authority" tone={healthy ? "success" : "warning"}>
            <BadgeDot />
            <span className="truncate">{authorityText(state.authority)}</span>
          </Badge>
        }
        description={state.detail}
        eyebrow="Local knowledge, one authority"
        title={state.headline}
      >
        <div data-phase={state.phase}>
          <span className="sr-only" data-testid="phase">
            {state.headline}
          </span>
          <HomeIdentity state={state} />

          {state.notice === null ? null : (
            <Alert className="mt-6" data-testid="notice" tone="warning">
              {state.notice}
            </Alert>
          )}
          {state.error === null ? null : (
            <Alert className="mt-6" data-testid="error" tone="destructive">
              {state.error}
            </Alert>
          )}

          <section className="mt-6 grid items-start gap-6 @3xl/app-shell:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
            <Card className="p-7 shadow-md @3xl/app-shell:p-8">
              <ActionPanel bridge={bridge} state={state} setState={setState} />
            </Card>
            <Inventory state={state} />
          </section>
        </div>
      </PageScaffold>
    </AppShell>
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
