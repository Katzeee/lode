import { frontierCovers } from "../../../domain/fact/index.js";
import type { FactAuthority } from "../../authority/fact-authority.js";
import type { WorkspaceProjectionLifecycle } from "../projection-lifecycle/index.js";
import type { WorkspaceSignals } from "../workspace-signals.js";

export { ensureWorkspaceGenesis } from "./genesis.js";

type WorkspaceAuthorityLifecycleOptions = Readonly<{
  facts: Pick<FactAuthority, "admission" | "recoverToLastValidPrefix">;
  projection: WorkspaceProjectionLifecycle;
  signals: WorkspaceSignals;
}>;

export class WorkspaceAuthorityLifecycle {
  constructor(private readonly options: WorkspaceAuthorityLifecycleOptions) {}

  async reconcileAdvance(): Promise<void> {
    const admission = this.options.facts.admission();
    if (admission.kind === "fault") {
      this.options.signals.recordAuthorityFault(
        admission.fault ?? "Authority admission fault",
        this.options.projection.identity,
      );
      return;
    }
    this.options.signals.clearAuthorityFault();
    const snapshot = admission.snapshot;
    if (frontierCovers(this.options.projection.identity.frontier, snapshot.frontier)) {
      return;
    }
    this.options.signals.emit("authority-advanced", snapshot.frontier, null);
    await this.options.projection.advance(snapshot);
  }

  async recover(): Promise<void> {
    if (this.options.facts.admission().kind !== "fault") {
      return;
    }
    const snapshot = await this.options.facts.recoverToLastValidPrefix();
    this.options.signals.clearAuthorityFault();
    if (!frontierCovers(this.options.projection.identity.frontier, snapshot.frontier)) {
      await this.options.projection.advance(snapshot);
    }
    this.options.signals.emit("projection-recovered", snapshot.frontier, this.options.projection.identity.generationId);
  }
}
