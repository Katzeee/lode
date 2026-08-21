import type { EngineEvent, Unsubscribe } from "@lode/sdk";

export type EventSink = Readonly<{
  publish(event: EngineEvent): void;
}>;

export type EventCapability = EventSink &
  Readonly<{
    subscribe(listener: (event: EngineEvent) => void): Unsubscribe;
  }>;
