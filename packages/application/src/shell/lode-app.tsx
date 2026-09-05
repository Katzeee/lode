import { Alert, AppShell, Button, LegalPage, PageScaffold, Spinner, ToastProvider, TooltipProvider } from "@lode/ui";
import { lazy, Suspense, useEffect, useState } from "react";
import type { ApplicationHost, ApplicationState } from "../session/contract.js";
import { SetupForm } from "./setup-form.js";
import { WorkspacePage } from "../workspace/workspace-page.js";

const Catalog = lazy(async () => ({ default: (await import("@lode/ui/catalog")).DesignSystemPage }));
export function LodeApp({ host }: Readonly<{ host: ApplicationHost }>) {
  const [state, setState] = useState<ApplicationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState(() => location.hash);
  const workspaceId = route.startsWith("#/workspace/") ? decodeURIComponent(route.slice(12)) : null;
  const [recovery, setRecovery] = useState<string | null>(null);
  const refresh = () =>
    host
      .getState()
      .then(setState)
      .catch((error: unknown) => setError(message(error)));
  useEffect(() => {
    let active = true;
    const update = () => {
      void host
        .getState()
        .then((state) => {
          if (active) {
            setState(state);
            setError(null);
          }
        })
        .catch((error: unknown) => {
          if (active) {
            setError(message(error));
          }
        });
    };
    const unsubscribe = host.onStateChanged(setState);
    const stopEvents = host.engine.subscribe(update, (error) => setError(message(error)));
    const navigation = () => setRoute(location.hash);
    update();
    window.addEventListener("focus", update);
    window.addEventListener("hashchange", navigation);
    return () => {
      active = false;
      stopEvents();
      unsubscribe();
      window.removeEventListener("focus", update);
      window.removeEventListener("hashchange", navigation);
    };
  }, [host]);
  const selected = state?.workspaces.find((workspace) => workspace.workspaceId === workspaceId) ?? state?.workspaces[0];
  let content;
  if (route.startsWith("#/design-system")) {
    content = <Catalog productPreview={<p>Open the application home to use your workspace.</p>} />;
  } else if (route === "#/legal") {
    content = <LegalPage />;
  } else {
    content = (
      <AppShell
        activeItemId={selected?.workspaceId ?? "home"}
        sections={[
          {
            id: "workspaces",
            label: "Workspaces",
            items: (state?.workspaces ?? []).map((workspace) => ({
              id: workspace.workspaceId,
              label: workspace.label,
              icon: "house",
              target: `#/workspace/${encodeURIComponent(workspace.workspaceId)}`,
            })),
          },
        ]}
      >
        {error === null ? null : (
          <Alert tone="destructive">
            {error}
            <Button
              variant="ghost"
              onClick={() => {
                setError(null);
                void refresh();
              }}
            >
              Retry
            </Button>
          </Alert>
        )}
        {state === null ? (
          <PageScaffold title="Opening Lode">
            <Spinner label="Opening your space" />
          </PageScaffold>
        ) : recovery !== null ? (
          <PageScaffold title="Keep your recovery phrase">
            <p className="text-body text-muted-foreground">Save this phrase somewhere private before continuing.</p>
            <p className="my-6 rounded-md border bg-muted p-5 font-mono wrap-anywhere" data-testid="recovery-phrase">
              {recovery}
            </p>
            <Button onClick={() => setRecovery(null)}>I saved my recovery phrase</Button>
          </PageScaffold>
        ) : state.phase !== "ready" || selected === undefined ? (
          <SetupForm host={host} state={state} onState={setState} onRecovery={setRecovery} />
        ) : (
          <WorkspacePage
            key={selected.workspaceId}
            host={host}
            workspace={selected}
            actorId={state.actors.find((actor) => actor.unlocked)?.actorId ?? ""}
          />
        )}
      </AppShell>
    );
  }
  return (
    <TooltipProvider>
      <ToastProvider>
        <Suspense fallback={<Spinner label="Loading Lode" />}>{content}</Suspense>
      </ToastProvider>
    </TooltipProvider>
  );
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
