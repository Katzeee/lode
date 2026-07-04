import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rotatingFileDestination } from "./rotating-file.js";

/** Drain a Writable to `finish` (after the `final` hook flushes the underlying file stream). */
function end(sink: { end(cb?: () => void): void }): Promise<void> {
  return new Promise((resolve) => sink.end(() => resolve()));
}

describe("rotatingFileDestination", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lode-log-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends to the file while under the limit", async () => {
    const path = join(dir, "app.log");
    const sink = rotatingFileDestination({ path, maxSize: 1000, maxBackups: 3 });
    sink.write("line-one\n");
    sink.write("line-two\n");
    await end(sink);
    expect(readFileSync(path, "utf8")).toBe("line-one\nline-two\n");
  });

  it("rotates when a write would exceed maxSize (path newest, .1 next, …)", async () => {
    const path = join(dir, "rot.log");
    const sink = rotatingFileDestination({ path, maxSize: 10, maxBackups: 3 });
    sink.write("aaaaaaaaa\n"); // 9 bytes → fits (9 ≤ 10)
    sink.write("bbbbbbbbb\n"); // 9 + 9 > 10 → rotate, then write to fresh path
    sink.write("ccccccccc\n"); // rotate again
    await end(sink);
    expect(readFileSync(path, "utf8")).toBe("ccccccccc\n");
    expect(readFileSync(`${path}.1`, "utf8")).toBe("bbbbbbbbb\n");
    expect(readFileSync(`${path}.2`, "utf8")).toBe("aaaaaaaaa\n");
    expect(existsSync(`${path}.3`)).toBe(false);
  });

  it("drops the oldest backup once maxBackups is exceeded", async () => {
    const path = join(dir, "drop.log");
    const sink = rotatingFileDestination({ path, maxSize: 5, maxBackups: 2 });
    sink.write("111\n");
    sink.write("222\n"); // rotate: .1=111
    sink.write("333\n"); // rotate: .2=111, .1=222
    sink.write("444\n"); // rotate: drop .2(111), .2=222, .1=333
    await end(sink);
    expect(readFileSync(path, "utf8")).toBe("444\n");
    expect(readFileSync(`${path}.1`, "utf8")).toBe("333\n");
    expect(readFileSync(`${path}.2`, "utf8")).toBe("222\n");
    expect(existsSync(`${path}.3`)).toBe(false);
  });

  it("resumes the byte count from an existing file's size on startup", async () => {
    const path = join(dir, "resume.log");
    const first = rotatingFileDestination({ path, maxSize: 12, maxBackups: 2 });
    first.write("existing\n"); // 9 bytes
    await end(first);
    expect(statSyncSafe(path)).toBe(9);
    // A second sink over the same file picks up the existing size — the next near-the-limit write
    // rotates rather than appending past the cap.
    const second = rotatingFileDestination({ path, maxSize: 12, maxBackups: 2 });
    second.write("more\n"); // existing 9 + 5 = 14 > 12 → rotate, then write "more"
    await end(second);
    expect(readFileSync(path, "utf8")).toBe("more\n");
    expect(readFileSync(`${path}.1`, "utf8")).toBe("existing\n");
  });
});

function statSyncSafe(path: string): number {
  return readFileSync(path).byteLength;
}
