import type { RuntimeInstance } from "./runtime.js";
import type { DeviceState, StopReason } from "./types.js";

export type RuntimeResource = {
  readonly id: string;
  start?(instance: RuntimeInstance): void | Promise<void>;
  quiesce?(reason: StopReason): void | Promise<void>;
  checkpoint?(): void | Promise<void>;
  release?(): void | Promise<void>;
  onDeviceState?(state: DeviceState): void;
};

export type MountedComponent<T> = {
  readonly instance: RuntimeInstance;
  readonly api: T;
};
