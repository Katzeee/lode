import { describe, expect, it } from "vitest";
import { RwWorkspaceLock } from "./loro-lock.js";

/** A deferred barrier the test holds to release a locked operation at a controlled point. */
function barrier(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

describe("RwWorkspaceLock", () => {
  it("admits concurrent readers", async () => {
    const lock = new RwWorkspaceLock();
    let active = 0;
    let maxConcurrent = 0;
    const reader = () =>
      lock.read(() => {
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        return Promise.resolve().then(() => {
          active--;
        });
      });
    await Promise.all([reader(), reader(), reader()]);
    expect(maxConcurrent).toBe(3);
  });

  it("serializes writers (mutual exclusion)", async () => {
    const lock = new RwWorkspaceLock();
    let active = 0;
    let maxConcurrent = 0;
    const writer = () =>
      lock.write(() => {
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        return Promise.resolve().then(() => {
          active--;
        });
      });
    await Promise.all([writer(), writer(), writer()]);
    expect(maxConcurrent).toBe(1);
  });

  it("excludes readers while a write is in progress", async () => {
    const lock = new RwWorkspaceLock();
    const writeStarted = barrier();
    const writeDone = barrier();
    let readObservedWriteActive = false;
    const write = lock.write(async () => {
      writeStarted.release();
      await writeDone.wait;
    });
    await writeStarted.wait; // write holds exclusive
    const read = lock.read(() => {
      readObservedWriteActive = true;
    });
    // Yield: the read must still be queued (write holds the lock).
    await Promise.resolve();
    await Promise.resolve();
    expect(readObservedWriteActive).toBe(false);
    writeDone.release();
    await write;
    await read;
    expect(readObservedWriteActive).toBe(true);
  });

  it("write-priority: a queued writer blocks new readers (no writer starvation)", async () => {
    const lock = new RwWorkspaceLock();
    const readerDone = barrier();
    const writerDone = barrier();
    let lateReaderObserved = false;
    // R1 holds a read lock.
    const r1 = lock.read(async () => {
      await readerDone.wait;
    });
    await Promise.resolve();
    // W1 queues behind R1.
    const w1 = lock.write(async () => {
      await writerDone.wait;
    });
    await Promise.resolve();
    // R2 arrives AFTER W1 is queued → write-priority must block it behind W1.
    const r2 = lock.read(() => {
      lateReaderObserved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    // Let R1 finish; W1 should run next (not R2).
    readerDone.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(lateReaderObserved).toBe(false); // R2 still blocked behind W1
    writerDone.release();
    await w1;
    await r1;
    await r2;
    expect(lateReaderObserved).toBe(true);
  });

  it("writers do not starve readers: queued readers wake once a writer releases", async () => {
    const lock = new RwWorkspaceLock();
    const writerDone = barrier();
    let r1Ran = false;
    let r2Ran = false;
    const w = lock.write(async () => {
      await writerDone.wait;
    });
    await Promise.resolve();
    const r1 = lock.read(() => {
      r1Ran = true;
    });
    const r2 = lock.read(() => {
      r2Ran = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(r1Ran).toBe(false);
    expect(r2Ran).toBe(false);
    writerDone.release();
    await w;
    await r1;
    await r2;
    expect(r1Ran).toBe(true);
    expect(r2Ran).toBe(true);
  });

  it("runs the body and propagates the return value", async () => {
    const lock = new RwWorkspaceLock();
    const readResult = await lock.read(() => 42);
    const writeResult = await lock.write(() => "x");
    expect(readResult).toBe(42);
    expect(writeResult).toBe("x");
  });

  it("releases the lock if the body throws (no deadlock on next acquire)", async () => {
    const lock = new RwWorkspaceLock();
    await expect(
      lock.write(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Lock must have been released — a fresh write should acquire immediately.
    let ran = false;
    await lock.write(() => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("assertWritable throws inside a shared (read) boundary", async () => {
    const lock = new RwWorkspaceLock();
    await expect(lock.read(() => lock.assertWritable())).rejects.toThrow(/read-only/);
  });

  it("assertWritable passes inside an exclusive (write) boundary", async () => {
    const lock = new RwWorkspaceLock();
    let threw = false;
    await lock.write(() => {
      try {
        lock.assertWritable();
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
  });

  it("assertWritable throws when no lock is held at all", () => {
    const lock = new RwWorkspaceLock();
    expect(() => lock.assertWritable()).toThrow(/read-only/);
  });
});
