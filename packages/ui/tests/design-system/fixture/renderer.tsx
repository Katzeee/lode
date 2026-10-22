import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { AppShell, ToastProvider, TooltipProvider, type AppShellSection } from "../../../dist/index.js";
import { DesignSystemPage } from "../../../dist/catalog/index.js";
import { OutlineExtensionFixture } from "./outline-extension-fixture.js";
import { OutlineSuggestionFixture } from "./outline-suggestion-fixture.js";
import { NodeEditorRegionsFixture } from "./node-editor-regions-fixture.js";
import { NodeEditorLifecycleFixture } from "./node-editor-lifecycle-fixture.js";
import { NodeEditorCapabilitiesFixture, NodeEditorMoveSelectionFixture } from "./node-editor-capabilities-fixture.js";
import {
  DelayedRegionFixture,
  NestedRegionFixture,
  ImmediateInsertionFixture,
} from "./node-editor-composition-fixture.js";

const previewSections: readonly AppShellSection[] = [
  {
    id: "workspace",
    items: [
      { icon: "house", id: "home", label: "Home", target: "#/" },
      { icon: "list-tree", id: "notes", label: "Notes", target: "#/notes" },
      { icon: "messages-square", id: "inbox", label: "Inbox", target: "#/inbox" },
    ],
  },
];

function SharedProductPreview() {
  return (
    <AppShell activeItemId="notes" sections={previewSections}>
      <main className="mx-auto w-full max-w-180 px-4 py-8">
        <h2 className="text-title font-semibold">Shared product surface</h2>
        <p className="mt-2 text-body text-muted-foreground">
          A platform-neutral host exercises the same responsive shell used by desktop and mobile.
        </p>
      </main>
    </AppShell>
  );
}

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("The design-system test root is missing");
}

function TestSurface() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  if (hash === "#/outline-suggestion-fixture") {
    return <OutlineSuggestionFixture />;
  }
  if (hash.startsWith("#/node-editor-regions")) {
    return <NodeEditorRegionsFixture empty={hash.endsWith("-empty")} delayed={hash.endsWith("-delayed")} />;
  }
  if (hash.startsWith("#/node-editor-lifecycle")) {
    return <NodeEditorLifecycleFixture empty={hash.endsWith("-empty")} />;
  }
  if (hash === "#/node-editor-capabilities") {
    return <NodeEditorCapabilitiesFixture />;
  }
  if (hash.startsWith("#/node-editor-move-selection")) {
    return <NodeEditorMoveSelectionFixture delayed={hash.endsWith("-delayed")} />;
  }
  if (hash.startsWith("#/node-editor-late-region")) {
    return <DelayedRegionFixture existing={hash.endsWith("-existing")} />;
  }
  if (hash === "#/node-editor-nested-region") {
    return <NestedRegionFixture />;
  }
  if (hash === "#/node-editor-immediate-insertion") {
    return <ImmediateInsertionFixture />;
  }
  if (hash === "#/outline-command-fixture") {
    return <OutlineExtensionFixture commandsEnabled />;
  }
  return hash === "#/outline-extension-fixture" ? (
    <OutlineExtensionFixture />
  ) : (
    <DesignSystemPage productPreview={<SharedProductPreview />} />
  );
}

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <TestSurface />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
