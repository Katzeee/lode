import { randomUUID } from "node:crypto";

import type { DesktopClient, HomeSelection } from "@lode/desktop-client";

import type { DesktopState, InitializeHomeInput, InitializeHomeResult } from "../bridge/contract.cjs";
import type { AuthorityShutdown, DaemonAuthority } from "./authority.js";

const initialState: DesktopState = {
  phase: "initializing",
  headline: "Initializing Lode",
  detail: "Preparing the selected Home and its Engine authority.",
  home: null,
  authority: "none",
  actors: [],
  workspaces: [],
  notice: null,
  error: null,
};

type StateListener = (state: DesktopState) => void;

export class DesktopHost {
  private current: DesktopState = initialState;
  private client: DesktopClient | undefined;
  private readonly listeners = new Set<StateListener>();

  constructor(private readonly authority: DaemonAuthority) {}

  state(): DesktopState {
    return this.current;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(selection: HomeSelection): Promise<DesktopState> {
    this.publish({
      ...initialState,
      home: selection,
      authority: "starting",
      detail: `Connecting to the Engine authority for Home “${selection.name}”.`,
    });
    try {
      const connection = await this.authority.connect(selection);
      this.client = connection.client;
      this.publish({
        ...this.current,
        authority: connection.ownership,
        notice: connection.notice,
      });
      return await this.refresh();
    } catch (error) {
      return this.fail(error, "The desktop host could not establish an Engine authority.");
    }
  }

  async initializeHome(input: InitializeHomeInput): Promise<InitializeHomeResult> {
    const client = this.requireClient();
    try {
      const created = await client.createActor({ label: input.actorLabel, passphrase: input.passphrase });
      await client.createWorkspace(randomUUID(), input.workspaceLabel, created.actorId);
      return { recoveryPhrase: created.recoveryPhrase, state: await this.refresh() };
    } catch (error) {
      this.operationFailed(error);
    }
  }

  async unlockVault(passphrase: string): Promise<DesktopState> {
    try {
      await this.requireClient().unlockVault(passphrase);
      return await this.refresh();
    } catch (error) {
      this.operationFailed(error);
    }
  }

  async createWorkspace(label: string): Promise<DesktopState> {
    const client = this.requireClient();
    try {
      const identity = await client.listActors();
      const actor = identity.actors.find((candidate) => candidate.unlocked);
      if (actor === undefined) {
        throw new Error("Unlock the Actor Vault before creating a Workspace");
      }
      await client.createWorkspace(randomUUID(), label, actor.actorId);
      return await this.refresh();
    } catch (error) {
      this.operationFailed(error);
    }
  }

  async close(): Promise<AuthorityShutdown> {
    this.client = undefined;
    return this.authority.close();
  }

  fail(error: unknown, detail = "Lode cannot continue until the problem is resolved."): DesktopState {
    const message = describe(error);
    const failed: DesktopState = {
      ...this.current,
      phase: "error",
      headline: "Unable to start Lode",
      detail,
      error: message,
    };
    this.publish(failed);
    return failed;
  }

  private async refresh(): Promise<DesktopState> {
    const client = this.requireClient();
    const [status, identity, workspaces] = await Promise.all([
      client.status(),
      client.listActors(),
      client.listWorkspaces(),
    ]);
    const phase = phaseFor(status.ready, identity);
    const state: DesktopState = {
      ...this.current,
      phase,
      headline: headlineFor(phase),
      detail: detailFor(phase, identity.actors.length, workspaces.length),
      home: { name: status.homeName || this.current.home?.name || "main", path: status.homePath },
      actors: identity.actors.map((actor) => ({
        actorId: actor.actorId,
        label: actor.label,
        unlocked: actor.unlocked,
      })),
      workspaces,
      error: null,
    };
    this.publish(state);
    return state;
  }

  private operationFailed(error: unknown): never {
    this.publish({ ...this.current, error: describe(error) });
    throw toError(error);
  }

  private requireClient(): DesktopClient {
    if (this.client === undefined) {
      throw new Error("The Engine authority is not connected");
    }
    return this.client;
  }

  private publish(state: DesktopState): void {
    this.current = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

function phaseFor(ready: boolean, identity: Awaited<ReturnType<DesktopClient["listActors"]>>): DesktopState["phase"] {
  if (!ready || !identity.vaultExists) {
    return "initializing";
  }
  return identity.actors.some((actor) => actor.unlocked) ? "ready" : "locked";
}

function headlineFor(phase: DesktopState["phase"]): string {
  switch (phase) {
    case "initializing":
      return "Initialize your Home";
    case "ready":
      return "Engine ready";
    case "locked":
      return "Vault locked";
    case "error":
      return "Unable to start Lode";
  }
}

function detailFor(phase: DesktopState["phase"], actorCount: number, workspaceCount: number): string {
  switch (phase) {
    case "initializing":
      return "Create the first Actor and Workspace to make this Home ready.";
    case "ready":
      return `${actorCount} Actor${actorCount === 1 ? "" : "s"} and ${workspaceCount} Workspace${workspaceCount === 1 ? "" : "s"} are available.`;
    case "locked":
      return `${actorCount} Actor${actorCount === 1 ? "" : "s"} and ${workspaceCount} Workspace${workspaceCount === 1 ? "" : "s"} are stored locally. Unlock the Vault to make changes.`;
    case "error":
      return "Lode cannot continue until the problem is resolved.";
  }
}

function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
