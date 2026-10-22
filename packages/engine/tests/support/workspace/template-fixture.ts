import { expect } from "vitest";
import {
  createTransportEngineApplication,
  type EditAction,
  type ProjectionPage,
  type ProjectionPageSection,
} from "@lode/sdk";
import { engineCommandFromMessage, writeResultToMessage } from "@lode/sdk/host";
import { openTestWorkspace } from "./open-test-workspace.js";
import { InMemoryDocumentStore } from "../document-store.js";
import { nodeAt, createSupertagApplication } from "./edit-test-actions.js";
import { CURRENT_PROJECTION_VERSIONS as versions } from "../../../src/domain/reconcile/index.js";
import { FactAuthority } from "../../../src/subsystems/workspace/authority/fact-authority.js";

export async function templateFixture(loroPeerId: `${number}`, documents = new InMemoryDocumentStore(), setup = true) {
  const facts = await FactAuthority.open({ workspaceId: "workspace", documents, loroPeerId });
  const workspace = await openTestWorkspace({ workspaceId: "workspace", facts, versions });
  const client = createTransportEngineApplication({
    execute: async (message) => ({
      status: "response",
      message: writeResultToMessage(await workspace.execute(engineCommandFromMessage(message))),
    }),
    query: () => {
      throw new Error("Template fixture reads projection through the direct query surface");
    },
    subscribe: () => () => {},
  });
  let sequence = 0;
  async function edit(actions: readonly EditAction[], channel = "local", intent: "direct" | "proposal" = "direct") {
    const result = await client.execute({
      kind: "edit",
      workspaceId: "workspace",
      actorId: channel,
      historyChannelId: channel,
      invocationId: `${loroPeerId}-edit-${sequence++}`,
      intent,
      actions,
    });
    expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
  }
  async function read<S extends ProjectionPageSection>(section: S): Promise<ProjectionPage<S>> {
    const result = await workspace.query({
      kind: "projection",
      workspaceId: "workspace",
      perspective: "origin",
      section,
    });
    if (!("section" in result) || result.section !== section) {
      throw new Error(`Missing ${section}`);
    }
    return result as ProjectionPage<S>;
  }
  if (setup) {
    await edit(
      [
        nodeAt("tag", "workspace", undefined, { intrinsicNodeType: "supertag-definition" }),
        nodeAt("one", "workspace"),
        nodeAt("two", "workspace"),
        createSupertagApplication("one", "tag"),
        createSupertagApplication("two", "tag"),
      ],
      "setup",
    );
  }
  return {
    workspace,
    facts,
    edit,
    read,
    close: () => workspace.close(),
    history: async (operation: "undo" | "redo") => {
      const state = await workspace.query({ kind: "history", workspaceId: "workspace", channelId: "local" });
      if (!(operation in state) || !state[operation]) {
        throw new Error(`Missing ${operation}`);
      }
      const result = await workspace.execute({
        kind: operation,
        workspaceId: "workspace",
        actorId: "local",
        invocationId: `${loroPeerId}-history-${sequence++}`,
        selection: state[operation],
      });
      expect(result, JSON.stringify(result)).toMatchObject({ status: "published" });
    },
  };
}
