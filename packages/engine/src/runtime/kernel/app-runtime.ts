import { RuntimeInstance } from "./runtime.js";
import type { RuntimeOptions, StopOptions, StopReport } from "./types.js";

export class AppRuntime {
  readonly root: RuntimeInstance;

  constructor(identity = "app", options: RuntimeOptions = {}) {
    this.root = new RuntimeInstance(identity, undefined, options);
  }

  start(): Promise<void> {
    return this.root.start();
  }

  stop(options: StopOptions = {}): Promise<StopReport> {
    return this.root.stop(options);
  }
}
