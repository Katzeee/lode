import { frontierCovers } from "../../../domain/fact/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";
import type { WorkspaceProjection } from "../projection/index.js";
import type { WorkspaceEventPublisher } from "../workspace-event-publisher.js";

export { ensureWorkspaceGenesis } from "./genesis.js";

type WorkspaceAuthorityCoordinatorOptions = Readonly<{
  facts: Pick<FactAuthorityPort, "snapshot">;
  projection: WorkspaceProjection;
  events?: WorkspaceEventPublisher;
}>;

export class WorkspaceAuthorityCoordinator {
  constructor(private readonly options: WorkspaceAuthorityCoordinatorOptions) {}

  reconcileAdvance(): void {
    const snapshot = this.options.facts.snapshot();
    if (frontierCovers(this.options.projection.identity.frontier, snapshot.frontier)) {
      return;
    }
    this.options.events?.publish("authority-advanced", snapshot.frontier, null);
    this.options.projection.advance(snapshot);
  }
}
