import { frontierCovers } from "../../../domain/fact/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";
import type { WorkspaceProjection } from "../projection/index.js";
import type { WorkspaceEventPublisher } from "../workspace-event-publisher.js";

export { ensureWorkspaceGenesis } from "./genesis.js";

type WorkspaceAuthorityCoordinatorOptions = Readonly<{
  facts: Pick<FactAuthorityPort, "admission" | "recoverToLastValidPrefix">;
  projection: WorkspaceProjection;
  events?: WorkspaceEventPublisher;
}>;

export class WorkspaceAuthorityCoordinator {
  constructor(private readonly options: WorkspaceAuthorityCoordinatorOptions) {}

  async reconcileAdvance(): Promise<void> {
    const admission = this.options.facts.admission();
    if (admission.kind === "fault") {
      return;
    }
    const snapshot = admission.snapshot;
    if (frontierCovers(this.options.projection.identity.frontier, snapshot.frontier)) {
      return;
    }
    this.options.events?.publish("authority-advanced", snapshot.frontier, null);
    await this.options.projection.advance(snapshot);
  }

  async recover(): Promise<void> {
    if (this.options.facts.admission().kind !== "fault") {
      return;
    }
    const snapshot = await this.options.facts.recoverToLastValidPrefix();
    if (!frontierCovers(this.options.projection.identity.frontier, snapshot.frontier)) {
      await this.options.projection.advance(snapshot);
    }
    this.options.events?.publish(
      "projection-recovered",
      snapshot.frontier,
      this.options.projection.identity.generationId,
    );
  }
}
