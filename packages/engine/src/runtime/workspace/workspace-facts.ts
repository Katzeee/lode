import type { EngineOrigin } from "../identity/caller.js";
import type { NodeUpdatedPayload } from "../../core/index.js";

/**
 * The workspace's single domain fact: a local mutation committed. Emitted by the wire layer
 * (`runMutation`) from the effects `Engine.captureEffects` returned. Subscribers: the client
 * notification projector (per connection) and the sync push fast-path.
 */
export class Committed {
  constructor(
    readonly workspaceId: string,
    readonly origin: EngineOrigin,
    readonly changes: readonly NodeUpdatedPayload[],
  ) {}
}
