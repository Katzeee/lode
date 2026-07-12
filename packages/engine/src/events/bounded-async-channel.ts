type Waiter<T> = {
  readonly resolve: (result: IteratorResult<T>) => void;
  readonly reject: (error: Error) => void;
};

/** A bounded single-consumer async channel. Overflow fails the stream instead of growing memory. */
export class BoundedAsyncChannel<T> implements AsyncIterable<T> {
  private readonly queue: T[] = [];
  private readonly waiters: Waiter<T>[] = [];
  private closed = false;
  private failure?: Error;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`channel capacity must be a positive integer, got ${capacity}`);
    }
  }

  push(value: T): boolean {
    if (this.closed) {
      return false;
    }
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve({ value, done: false });
      return true;
    }
    if (this.queue.length >= this.capacity) {
      this.fail(new Error(`notification channel exceeded capacity ${this.capacity}`));
      return false;
    }
    this.queue.push(value);
    return true;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.settleWaiters();
  }

  fail(error: Error): void {
    if (this.closed) {
      return;
    }
    this.failure = error;
    this.closed = true;
    this.settleWaiters();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const queued = this.queue.shift();
        if (queued !== undefined) {
          return Promise.resolve({ value: queued, done: false });
        }
        if (this.failure !== undefined) {
          return Promise.reject(this.failure);
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
      throw: (error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.fail(normalized);
        return Promise.reject(normalized);
      },
    };
  }

  private settleWaiters(): void {
    for (const waiter of this.waiters) {
      if (this.failure === undefined) {
        waiter.resolve({ value: undefined, done: true });
      } else {
        waiter.reject(this.failure);
      }
    }
    this.waiters.length = 0;
  }
}
