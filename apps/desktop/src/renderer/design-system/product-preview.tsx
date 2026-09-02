import { useState } from "react";

import type { DesktopBridge, DesktopState } from "../../bridge/contract.cjs";
import { DesktopApp } from "../product/desktop-app.js";
import { PageIntro } from "./specimen.js";

export function ProductPreviewPage() {
  const [bridge] = useState(createPreviewBridge);
  return (
    <>
      <PageIntro
        description="The real product shell, driven by an in-memory Engine stand-in. Initialize a Home to walk the actual flow."
        title="Product preview"
      />
      <div className="overflow-hidden rounded-xl border border-border bg-background shadow-md">
        <DesktopApp bridge={bridge} />
      </div>
    </>
  );
}

function createPreviewBridge(): DesktopBridge {
  const listeners = new Set<(state: DesktopState) => void>();
  let state: DesktopState = {
    phase: "initializing",
    headline: "Initialize your Home",
    detail: "This preview runs the production shell against an in-memory Engine stand-in.",
    home: { name: "preview", path: "~/.lode/preview" },
    authority: "owned",
    actors: [],
    workspaces: [],
    notice: null,
    error: null,
  };
  let workspaceCount = 0;

  const publish = (next: DesktopState) => {
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
    return state;
  };
  const workspace = (label: string) => {
    workspaceCount += 1;
    return { label, workspaceId: `ws_preview_${String(workspaceCount).padStart(4, "0")}` };
  };
  const ready = (detail: string): DesktopState => ({
    ...state,
    phase: "ready",
    headline: "Engine ready",
    detail,
    notice: null,
    error: null,
  });

  return {
    getState: () => Promise.resolve(state),
    initializeHome: (input) => {
      publish({
        ...ready("The preview Home is initialized; identity stays in this tab."),
        actors: [{ actorId: "actor_preview_0001", label: input.actorLabel, unlocked: true }],
        workspaces: [workspace(input.workspaceLabel)],
      });
      return Promise.resolve({
        recoveryPhrase: "paper forest night mint canvas vault anchor lantern quiet harbor stone ledger",
        state,
      });
    },
    unlockVault: () =>
      Promise.resolve(
        publish({
          ...ready("The vault is unlocked for this session."),
          actors: state.actors.map((actor) => ({ ...actor, unlocked: true })),
        }),
      ),
    createWorkspace: (label) =>
      Promise.resolve(publish({ ...ready("Workspace created."), workspaces: [...state.workspaces, workspace(label)] })),
    onStateChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
