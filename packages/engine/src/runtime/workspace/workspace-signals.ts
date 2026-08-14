import type { EngineEvent, Unsubscribe } from "../../application/contract.js";
import type { ProjectionIdentity } from "../../domain/fact/index.js";
import { deliverListeners } from "../../application/event-delivery.js";

export class WorkspaceSignals {
  private readonly listeners = new Set<(event: EngineEvent) => void>();

  constructor(
    private readonly workspaceId: string,
    private authorityFault: string | null,
  ) {}

  subscribe(listener: (event: EngineEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(
    kind: EngineEvent["kind"],
    frontier: EngineEvent["frontier"],
    generationId: string | null,
  ): void {
    const event = freezeWorkspaceEvent({
      kind,
      workspaceId: this.workspaceId,
      frontier: { ...frontier },
      generationId,
    });
    deliverListeners(this.listeners, event);
  }

  recordAuthorityFault(message: string, identity: ProjectionIdentity): void {
    if (this.authorityFault === null) {
      this.emit("projection-failed", identity.frontier, identity.generationId);
    }
    this.authorityFault = message;
  }

  clearAuthorityFault(): void {
    this.authorityFault = null;
  }

  clear(): void {
    this.listeners.clear();
  }
}

function freezeWorkspaceEvent(event: EngineEvent): EngineEvent {
  Object.freeze(event.frontier);
  return Object.freeze(event);
}
