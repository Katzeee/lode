export type DeviceState = "active" | "background" | "idle";

export type InstanceState =
  "new" | "starting" | "active" | "quiescing" | "draining" | "checkpointing" | "stopping" | "stopped";

export type StopReason = {
  readonly kind: "requested" | "owner" | "startup-failure" | "removed";
  readonly message?: string;
};

export type StopOptions = {
  readonly reason?: StopReason;
  readonly drainTimeoutMs?: number;
  readonly abortTimeoutMs?: number;
  readonly checkpoint?: boolean;
};

export type StopReport = {
  readonly graceful: boolean;
  readonly dirty: boolean;
  readonly errors: readonly Error[];
  readonly abandonedOperations: readonly string[];
};

export type RuntimeOptions = {
  readonly drainTimeoutMs?: number;
  readonly abortTimeoutMs?: number;
};

export class InstanceUnavailableError extends Error {
  constructor(identity: string, state: InstanceState) {
    super(`runtime instance '${identity}' is not accepting work (${state})`);
    this.name = "InstanceUnavailableError";
  }
}
