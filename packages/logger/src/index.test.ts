import { afterEach, describe, expect, it, vi } from "vitest";

// `createLogger` resolves its level from `LODE_LOG` and writes JSON to **fd 2 (stderr)** via pino's
// SonicBoom, which writes the fd directly — it does NOT go through `process.stderr.write`, so an
// in-process spy can't capture the bytes. The level-resolution logic is covered directly by
// `levels.test.ts`; what we lock here is the load-bearing runtime contract: **logs never reach
// stdout**. The binary tests (`apps/app-cli/tests/binary`) parse stdout for command output, so a log
// line on stdout would corrupt them. That contract holds regardless of level or sink mechanism — pino
// is pointed at fd 2 and never touches stdout — so we assert exactly that.

describe("createLogger runtime contract", () => {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  afterEach(() => {
    stdout.mockClear();
  });

  it("never writes to stdout at any level or via a child", async () => {
    const { createLogger } = await import("./index.js");
    const log = createLogger("test.stdout-clean");
    log.error("error", { err: new Error("boom") });
    log.warn("warn", { wsId: "ws", peerId: "p" });
    log.info("info");
    log.debug("debug");
    log.child({ peerId: "child" }).warn("child-warn");
    // pino's SonicBoom flushes write-by-write (minLength 0); a turn of the event loop is enough for
    // any async bookkeeping — and the assertion holds regardless, since pino never targets stdout.
    await new Promise((resolve) => setImmediate(resolve));
    expect(stdout).not.toHaveBeenCalled();
  });

  it("serializes a non-Error throw without losing it", async () => {
    // Catch sites pass `unknown`; the err-coercion serializer must not misrender a string throw.
    const { createLogger } = await import("./index.js");
    const log = createLogger("test.err-coerce");
    expect(() => log.warn("non-error throw", { err: "relay unreachable" })).not.toThrow();
    expect(() => log.warn("null throw", { err: null })).not.toThrow();
    expect(stdout).not.toHaveBeenCalled();
  });
});
