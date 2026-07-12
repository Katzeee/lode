import { createLogger } from "@lode/logger";

const log = createLogger("runtime.bus");

export type Subscription = {
  unsubscribe(): void;
};

/** A fact's class is its subscription key — `bus.on(MyFact, …)` / `bus.emit(new MyFact(…))` — so a
 *  fact payload is a plain typed value and the bus never decodes it. The `never[]` rest is the
 *  standard "match any constructor" parameter (no `any`): a real ctor `new (a: A) => T` is assignable
 *  to it because `never` (bottom) is assignable to every parameter type. */
export type FactClass<T> = new (...args: never[]) => T;

/** The map key: any fact constructor. `abstract` so a concrete `FactClass<T>` is assignable to it. */
type FactCtor = abstract new (...args: never[]) => unknown;

/**
 * A synchronous, type-keyed domain fact bus. `emit` fans an instance out to every handler registered
 * for its class,
 * inline and synchronously (a slow consumer blocks the publisher — keep handlers trivial). A
 * throwing handler is detached and the rest still receive, so one failing consumer can neither
 * stall the publisher nor starve its siblings.
 *
 * The concept that creates a bus explicitly registers its disposal with its runtime instance. This
 * leaf deliberately knows nothing about runtime ownership.
 */
export class Bus {
  private readonly handlers = new Map<FactCtor, Set<(fact: object) => void>>();
  private closed = false;

  constructor(readonly name = "bus") {}

  /** Subscribe to facts of `Ctor`. Returns null if the bus is already disposed. */
  on<T extends object>(Ctor: FactClass<T>, receive: (fact: T) => void): Subscription | null {
    if (this.closed) {
      return null;
    }
    let bucket = this.handlers.get(Ctor);
    if (bucket === undefined) {
      bucket = new Set();
      this.handlers.set(Ctor, bucket);
    }
    const set = bucket;
    const wrapped = (fact: object): void => receive(fact as T);
    set.add(wrapped);
    return {
      unsubscribe: () => {
        set.delete(wrapped);
      },
    };
  }

  /** Fan `fact` out to every handler registered for its class, synchronously. Throws if disposed. */
  emit<T extends object>(fact: T): void {
    if (this.closed) {
      throw new Error(`bus '${this.name}' is closed`);
    }
    const set = this.handlers.get(fact.constructor as FactCtor);
    if (set === undefined) {
      return;
    }
    for (const wrapped of [...set]) {
      try {
        wrapped(fact);
      } catch (error) {
        set.delete(wrapped);
        log.warn("bus handler failed and was detached", { bus: this.name, err: error });
      }
    }
  }

  /** Close the bus: subsequent `emit` throws, `on` returns null. Idempotent. */
  dispose(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.handlers.clear();
  }
}
