import type { EventFailureListener, Unsubscribe } from "@lode/sdk";

export function consumeEventStream<Value>(
  iterator: AsyncIterator<Value>,
  listener: (value: Value) => void,
  onError: EventFailureListener,
  signal: AbortSignal,
): Unsubscribe {
  let active = true;
  void (async () => {
    while (active) {
      let result: IteratorResult<Value>;
      try {
        result = await iterator.next();
      } catch (error) {
        active = false;
        if (!signal.aborted) {
          onError(error);
        }
        return;
      }
      if (result.done) {
        if (active && !signal.aborted) {
          onError(new Error("Daemon event stream ended while its subscription was active"));
        }
        return;
      }
      try {
        listener(result.value);
      } catch (error) {
        active = false;
        onError(error);
      }
    }
  })();
  return () => {
    if (!active) {
      return;
    }
    active = false;
    void iterator.return?.().catch(onError);
  };
}
