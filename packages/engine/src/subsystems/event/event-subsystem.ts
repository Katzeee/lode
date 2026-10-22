import type { EngineEvent } from "@lode/sdk";

import { defineEngineSubsystem } from "../definition.js";
import type { EventCapability } from "./capability.js";
import { deliverListeners } from "./event-delivery.js";

export function createEventSubsystemDefinition() {
  return defineEngineSubsystem({
    id: "event",
    dependencies: {},
    create: (_dependencies, control) => {
      const listeners = new Set<(event: EngineEvent) => void>();
      let active = false;
      return {
        capability: {
          subscribe: (listener, _onError) => {
            if (!active || control.stopRequested) {
              throw new Error("Event subsystem is not active");
            }
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          publish: (event) => {
            if (!active || control.stopRequested) {
              return;
            }
            if (!Object.isFrozen(event) || !Object.isFrozen(event.frontier)) {
              throw new Error("Event publishers must provide immutable events");
            }
            deliverListeners(listeners, event);
          },
        } satisfies EventCapability,
        start: () => {
          active = true;
        },
        stop: () => {
          active = false;
          listeners.clear();
        },
      };
    },
  });
}
