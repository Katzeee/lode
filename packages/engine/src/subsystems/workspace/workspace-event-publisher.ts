import type { EngineEvent } from "@lode/sdk";

import type { EventSink } from "../event/index.js";

export class WorkspaceEventPublisher {
  constructor(
    private readonly workspaceId: string,
    private readonly sink: EventSink,
  ) {}

  publish(kind: EngineEvent["kind"], frontier: EngineEvent["frontier"], generationId: string | null): void {
    const immutableFrontier = Object.freeze({ ...frontier });
    this.sink.publish(
      Object.freeze({ kind, workspaceId: this.workspaceId, frontier: immutableFrontier, generationId }),
    );
  }
}
