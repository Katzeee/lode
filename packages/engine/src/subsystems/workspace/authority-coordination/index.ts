import { frontierCovers, type FactFrontier } from "../../../domain/fact/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";
import type { WorkspaceProjection } from "../projection/index.js";

export { workspaceGenesisFact } from "./genesis-validation.js";

type WorkspaceAuthorityCoordinatorOptions = Readonly<{
  facts: Pick<FactAuthorityPort, "snapshot">;
  projection: WorkspaceProjection;
  publishAuthorityAdvance(frontier: FactFrontier): void;
}>;

export class WorkspaceAuthorityCoordinator {
  constructor(private readonly options: WorkspaceAuthorityCoordinatorOptions) {}

  reconcileAdvance(): void {
    const snapshot = this.options.facts.snapshot();
    if (frontierCovers(this.options.projection.identity.frontier, snapshot.frontier)) {
      return;
    }
    this.options.publishAuthorityAdvance(snapshot.frontier);
    this.options.projection.advance(snapshot);
  }
}
