import type { EngineEvent as ProtocolEngineEvent } from "@lode/protocol/proto";
import { type EngineApplicationContract, type EngineEvent, type Unsubscribe } from "@lode/sdk";
import { engineEventToMessage } from "@lode/sdk/host";

const MAX_BUFFERED_EVENTS = 256;

export function eventStream(
  subscribe: EngineApplicationContract["subscribe"],
  signal: AbortSignal,
): AsyncIterable<ProtocolEngineEvent> {
  const queue = new EventQueue();
  let unsubscribe: Unsubscribe = () => {};
  const closeSubscription = (): void => {
    const active = unsubscribe;
    unsubscribe = () => {};
    active();
  };
  unsubscribe = subscribe(
    (event) => {
      if (!queue.push(event)) {
        closeSubscription();
      }
    },
    (error) => {
      closeSubscription();
      queue.fail(error);
    },
  );
  if (queue.isClosed) {
    closeSubscription();
  }
  signal.addEventListener(
    "abort",
    () => {
      closeSubscription();
      queue.close();
    },
    { once: true },
  );
  return queue;
}

class EventQueue implements AsyncIterable<ProtocolEngineEvent> {
  private readonly values: ProtocolEngineEvent[] = [];
  private readonly waiters: Readonly<{
    resolve(result: IteratorResult<ProtocolEngineEvent>): void;
    reject(error: unknown): void;
  }>[] = [];
  private closed = false;
  private failure: Error | undefined;

  get isClosed(): boolean {
    return this.closed;
  }

  push(event: EngineEvent): boolean {
    if (this.closed) {
      return false;
    }
    const value = engineEventToMessage(event);
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
      return true;
    }
    if (this.values.length === MAX_BUFFERED_EVENTS) {
      this.fail(new Error(`Daemon event subscriber exceeded its ${MAX_BUFFERED_EVENTS}-event buffer`));
      return false;
    }
    this.values.push(value);
    return true;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown): void {
    if (this.closed) {
      return;
    }
    const failure = toError(error);
    this.failure = failure;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(failure);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<ProtocolEngineEvent> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) {
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          if (this.failure !== undefined) {
            return Promise.reject(this.failure);
          }
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
    };
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
