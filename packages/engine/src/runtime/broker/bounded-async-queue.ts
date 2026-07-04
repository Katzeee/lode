/**
 * A bounded async queue. `push()` is sync and **drop-on-overflow**: when the next item would push
 * the buffered total (by `sizeOf`) over `maxBytes`, the item is dropped (+ `onDrop`) instead of
 * queued. Used in two places:
 *   - the outgoing bidi iterable (Connect iterates it) — bounds the buffer between push and HTTP/2's
 *     flow-controlled drain (HTTP/2 flow control paces the drain but does NOT bound our push buffer);
 *   - a per-doc recv task queue (a drainer coroutine iterates it) — bounds the work stacked behind a
 *     slow WASM op (a Loro import/export), so a wedged doc can't grow it without bound → OOM.
 *
 * `close()` ends the iterable: the consumer's `for await` completes (and, on the bidi outgoing side,
 * Connect sees the request stream end — the signal that this peer disconnected). The async-iterator
 * `return()`/`throw()` let a consumer (Connect) abandon/cancel the iterable cleanly.
 */
export class BoundedAsyncQueue<T> implements AsyncIterable<T> {
  private readonly queue: T[] = [];
  private readonly waiters: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;
  private bufferedBytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly sizeOf: (item: T) => number,
    private readonly onDrop?: (item: T, itemBytes: number, buffered: number) => void,
  ) {}

  /** Push an item. Sync, never blocks. Dropped (+ `onDrop`) if it would push `bufferedBytes` over the
   *  cap — including a single item larger than the cap, regardless of whether a consumer is waiting
   *  (a giant item is dropped on its own). An item handed straight to a waiting consumer is not
   *  buffered, so it doesn't count against the cap (it's already being drained). */
  push(item: T): void {
    if (this.closed) {
      return;
    }
    const bytes = this.sizeOf(item);
    if (this.bufferedBytes + bytes > this.maxBytes) {
      this.onDrop?.(item, bytes, this.bufferedBytes);
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter({ value: item, done: false });
      return;
    }
    this.queue.push(item);
    this.bufferedBytes += bytes;
  }

  /** End the stream. The consumer's iteration completes (done). Push after close is a no-op. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters) {
      waiter({ value: undefined, done: true });
    }
    this.waiters.length = 0;
  }

  /** Whether the queue has been closed. */
  get isClosed(): boolean {
    return this.closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    const next = (): Promise<IteratorResult<T>> => {
      const queued = this.queue.shift();
      if (queued !== undefined) {
        this.bufferedBytes -= this.sizeOf(queued);
        return Promise.resolve({ value: queued, done: false });
      }
      if (this.closed) {
        return Promise.resolve({ value: undefined, done: true });
      }
      return new Promise((resolve) => this.waiters.push(resolve));
    };
    // `return()` lets a consumer abandoning the iterable (Connect tearing down the response stream)
    // unblock any pending waiter via close(). Idempotent with close().
    const resulting = (): Promise<IteratorResult<T>> => {
      this.close();
      return Promise.resolve({ value: undefined, done: true });
    };
    // `throw()` — Connect's bidi client calls this to abort the request stream (cancel/the peer hung
    // up). The async-iterator contract: close + propagate the error. Without it Connect raises
    // "AsyncIterable does not implement throw" and the whole stream dies.
    const throwing = (cause: unknown): Promise<IteratorResult<T>> => {
      this.close();
      return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    return { next, return: resulting, throw: throwing };
  }
}
