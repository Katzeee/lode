import type { EngineApplicationContract } from "@lode/sdk";
import type { EngineIdentity, EngineWorkspaces } from "@lode/sdk/host";
import type { ApplicationHost, ApplicationState, InitializeInput, InitializeResult } from "./contract.js";

export type ApplicationBackend = Readonly<{
  application: EngineApplicationContract;
  identity: Pick<EngineIdentity, "listActors" | "createActor" | "unlockVault">;
  workspaces: Pick<EngineWorkspaces, "listWorkspaces" | "createWorkspace">;
}>;

/** Owns product lifecycle; each host supplies the same Engine capabilities. */
export class ApplicationSession implements ApplicationHost {
  private readonly listeners = new Set<(state: ApplicationState) => void>();
  private lifecycle: Promise<unknown> = Promise.resolve();
  readonly engine: EngineApplicationContract;

  constructor(private readonly backend: ApplicationBackend) {
    this.engine = backend.application;
  }

  async getState(): Promise<ApplicationState> {
    const [identity, workspaces] = await Promise.all([
      this.backend.identity.listActors(),
      this.backend.workspaces.listWorkspaces(),
    ]);
    return {
      phase: !identity.vaultExists
        ? "initializing"
        : identity.actors.some((actor) => actor.unlocked)
          ? "ready"
          : "locked",
      actors: identity.actors,
      workspaces,
    };
  }

  initialize(input: InitializeInput): Promise<InitializeResult> {
    return this.exclusive(async () => {
      const before = await this.getState();
      if (before.phase !== "initializing") {
        throw new Error("This space already has an identity");
      }
      const actor = await this.backend.identity.createActor({ label: input.actorLabel, passphrase: input.passphrase });
      // Return the recovery phrase even if workspace creation needs a separate retry.
      const state = await this.publish();
      return { recoveryPhrase: actor.recoveryPhrase, state };
    });
  }

  unlock(passphrase: string): Promise<ApplicationState> {
    return this.exclusive(async () => {
      await this.backend.identity.unlockVault(passphrase);
      return this.publish();
    });
  }

  createWorkspace(label: string): Promise<ApplicationState> {
    return this.exclusive(async () => {
      const state = await this.getState();
      const actor = state.actors.find((candidate) => candidate.unlocked);
      if (actor === undefined) {
        throw new Error("Unlock your identity before creating a workspace");
      }
      await this.backend.workspaces.createWorkspace({
        workspaceId: crypto.randomUUID(),
        label,
        ownerActorId: actor.actorId,
      });
      return this.publish();
    });
  }

  onStateChanged(listener: (state: ApplicationState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async publish(): Promise<ApplicationState> {
    const state = await this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
    return state;
  }

  private exclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    const pending = this.lifecycle.then(operation);
    this.lifecycle = pending.catch(() => undefined);
    return pending;
  }
}
