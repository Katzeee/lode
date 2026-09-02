import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { DesktopState } from "../bridge/contract.cjs";
import type { AuthorityShutdown } from "./authority.js";

type VerificationReport = Readonly<{
  version: 1;
  desktopPid: number;
  state: DesktopState;
  shutdown: AuthorityShutdown | null;
}>;

export class VerificationReporter {
  private report: VerificationReport;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    state: DesktopState,
  ) {
    this.report = { version: 1, desktopPid: process.pid, state, shutdown: null };
  }

  stateChanged(state: DesktopState): void {
    this.report = { ...this.report, state };
    this.write();
  }

  async closed(shutdown: AuthorityShutdown): Promise<void> {
    this.report = { ...this.report, shutdown };
    this.write();
    await this.pending;
  }

  async flush(): Promise<void> {
    this.write();
    await this.pending;
  }

  private write(): void {
    const contents = `${JSON.stringify(this.report, null, 2)}\n`;
    this.pending = this.pending.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, contents, "utf8");
      await rename(temporary, this.path);
    });
  }
}

export function verificationReportPath(argv: readonly string[]): string | null {
  const prefix = "--lode-verification-report=";
  const inline = argv.find((value) => value.startsWith(prefix));
  if (inline !== undefined) {
    const path = inline.slice(prefix.length);
    if (path.length === 0) {
      throw new Error("--lode-verification-report requires a path");
    }
    return path;
  }
  const index = argv.indexOf("--lode-verification-report");
  if (index < 0) {
    return null;
  }
  const path = argv[index + 1];
  if (path === undefined || path.startsWith("--")) {
    throw new Error("--lode-verification-report requires a path");
  }
  return path;
}
