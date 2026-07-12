import { toError } from "./invoke.js";

export class StopNotifier {
  private readonly listeners = new Set<() => void>();
  private stopped = false;

  listen(listener: () => void): () => void {
    if (this.stopped) {
      listener();
      return () => {};
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(errors: Error[]): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        errors.push(toError(error));
      }
    }
    this.listeners.clear();
  }
}
