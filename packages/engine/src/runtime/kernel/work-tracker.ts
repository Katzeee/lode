type TrackedWork = { readonly name: string; readonly promise: Promise<void> };

export class WorkTracker {
  private readonly active = new Map<symbol, TrackedWork>();
  private readonly failures: Error[] = [];

  constructor(private readonly owner: string) {}

  track(name: string, promise: Promise<void>): void {
    const id = Symbol(name);
    const tracked = promise.finally(() => this.active.delete(id));
    this.active.set(id, { name, promise: tracked });
  }

  recordFailure(error: Error): void {
    this.failures.push(error);
  }

  promises(): Promise<void>[] {
    return [...this.active.values()].map(({ promise }) => promise);
  }

  names(): string[] {
    return [...this.active.values()].map(({ name }) => `${this.owner}:${name}`);
  }

  errors(): Error[] {
    return [...this.failures];
  }
}

export async function waitForWork(
  promises: readonly Promise<void>[],
  timeoutMs: number,
): Promise<boolean> {
  if (promises.length === 0) {
    return true;
  }
  const settled = Promise.allSettled(promises).then(() => true);
  const timedOut = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([settled, timedOut]);
}
