import { describe, expect, it, vi } from "vitest";

import { consumeEventStream } from "./event-stream.js";

describe("daemon event stream consumption", () => {
  it("reports an active stream failure", async () => {
    const failure = new Error("stream failed");
    const onError = vi.fn<(error: unknown) => void>();
    consumeEventStream(
      { next: () => Promise.reject(failure) },
      vi.fn<(value: unknown) => void>(),
      onError,
      new AbortController().signal,
    );

    await settle();

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("treats owner abort as an intentional stream end", async () => {
    const abort = new AbortController();
    const onError = vi.fn<(error: unknown) => void>();
    abort.abort();
    consumeEventStream(
      { next: () => Promise.reject(new Error("aborted")) },
      vi.fn<(value: unknown) => void>(),
      onError,
      abort.signal,
    );

    await settle();

    expect(onError).not.toHaveBeenCalled();
  });

  it("reports unexpected EOF and unsubscribe cleanup failure", async () => {
    const eofError = vi.fn<(error: unknown) => void>();
    consumeEventStream(
      { next: () => Promise.resolve({ value: undefined, done: true }) },
      vi.fn<(value: unknown) => void>(),
      eofError,
      new AbortController().signal,
    );
    await settle();
    const reportedEof = eofError.mock.calls[0]?.[0];
    expect(reportedEof).toBeInstanceOf(Error);
    expect((reportedEof as Error).message).toContain("ended");

    const cleanupError = new Error("return failed");
    const onCleanupError = vi.fn<(error: unknown) => void>();
    const unsubscribe = consumeEventStream(
      { next: () => new Promise<IteratorResult<unknown>>(() => {}), return: () => Promise.reject(cleanupError) },
      vi.fn<(value: unknown) => void>(),
      onCleanupError,
      new AbortController().signal,
    );
    unsubscribe();
    await settle();
    expect(onCleanupError).toHaveBeenCalledWith(cleanupError);
  });
});

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
