import type { ApplicationConnection, ApplicationEvent } from "@lode/application/host";
export function createWebConnection(): ApplicationConnection {
  const listeners = new Set<(event: ApplicationEvent) => void>();
  let events: EventSource | undefined;
  const emit = (event: ApplicationEvent) => {
    for (const listener of listeners) {
      listener(event);
    }
  };
  const request: ApplicationConnection["request"] = async (method, input) => {
    const response = await fetch("/api/application", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, input }),
    });
    const result = (await response.json()) as { value?: unknown; error?: string };
    if (!response.ok) {
      throw new Error(result.error ?? "Unable to reach the local application");
    }
    return result.value;
  };
  return {
    request,
    subscribe: (listener) => {
      listeners.add(listener);
      // One stream per host connection keeps multiple UI subscribers and tabs within browser connection limits.
      if (!events) {
        events = new EventSource("/api/events");
        events.onmessage = (message) => emit(JSON.parse(String(message.data)) as ApplicationEvent);
        events.onerror = () =>
          emit({ kind: "error", message: "Connection interrupted. Reconnecting to the local application…" });
        events.onopen = () => {
          void request("state")
            .then((state) =>
              emit({ kind: "state", state: state as Extract<ApplicationEvent, { kind: "state" }>["state"] }),
            )
            .catch((error: unknown) =>
              emit({ kind: "error", message: error instanceof Error ? error.message : String(error) }),
            );
        };
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          events?.close();
          events = undefined;
        }
      };
    },
  };
}
