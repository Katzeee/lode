import { createLogger } from "@lode/logger";
import { toError } from "./invoke.js";
import type { StopReason } from "./types.js";
import { WorkTracker } from "./work-tracker.js";

const log = createLogger("runtime.instance");

export class InstanceExecution {
  private readonly quiesceController = new AbortController();
  private readonly forceController = new AbortController();
  private readonly work: WorkTracker;

  constructor(private readonly identity: string) {
    this.work = new WorkTracker(identity);
  }

  get quiescing(): AbortSignal {
    return this.quiesceController.signal;
  }

  get forcedAbort(): AbortSignal {
    return this.forceController.signal;
  }

  closeAdmission(reason: StopReason): void {
    this.quiesceController.abort(reason);
  }

  force(): void {
    this.forceController.abort(new Error(`runtime instance '${this.identity}' drain timed out`));
  }

  spawn(name: string, task: (quiescing: AbortSignal) => Promise<void>): void {
    const promise = Promise.resolve()
      .then(() => task(this.quiesceController.signal))
      .catch((error: unknown) => {
        const normalized = toError(error);
        this.work.recordFailure(normalized);
        log.warn("runtime background task rejected", {
          instance: this.identity,
          task: name,
          err: normalized,
        });
      });
    this.work.track(name, promise);
  }

  run<T>(name: string, operation: (forcedAbort: AbortSignal) => Promise<T>): Promise<T> {
    const promise = Promise.resolve().then(() => operation(this.forceController.signal));
    this.work.track(
      name,
      promise.then(
        () => undefined,
        () => undefined,
      ),
    );
    return promise;
  }

  promises(): Promise<void>[] {
    return this.work.promises();
  }

  names(): string[] {
    return this.work.names();
  }

  errors(): Error[] {
    return this.work.errors();
  }
}
