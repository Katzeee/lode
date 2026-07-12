import {
  InstanceUnavailableError,
  type DeviceState,
  type InstanceState,
  type RuntimeOptions,
  type StopOptions,
  type StopReason,
  type StopReport,
} from "./types.js";
import type { MountedComponent, RuntimeResource } from "./resource.js";
import { invoke, toError } from "./invoke.js";
import { waitForWork } from "./work-tracker.js";
import { InstanceExecution } from "./execution.js";
import { StopNotifier } from "./stop-notifier.js";

const DEFAULT_DRAIN_TIMEOUT_MS = 5000;
const DEFAULT_ABORT_TIMEOUT_MS = 1000;

type OwnedMember =
  | { readonly kind: "resource"; readonly resource: RuntimeResource; started: boolean }
  | { readonly kind: "child"; readonly child: RuntimeInstance };

export class RuntimeInstance {
  private readonly members: OwnedMember[] = [];
  private readonly execution: InstanceExecution;
  private readonly stopNotifier = new StopNotifier();
  private readonly drainTimeoutMs: number;
  private readonly abortTimeoutMs: number;
  private currentState: InstanceState = "new";
  private deviceState: DeviceState = "active";
  private stopPromise?: Promise<StopReport>;
  private released = false;

  constructor(
    readonly identity: string,
    readonly owner?: RuntimeInstance,
    options: RuntimeOptions = {},
  ) {
    this.drainTimeoutMs =
      options.drainTimeoutMs ?? owner?.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    this.abortTimeoutMs =
      options.abortTimeoutMs ?? owner?.abortTimeoutMs ?? DEFAULT_ABORT_TIMEOUT_MS;
    this.deviceState = owner?.deviceState ?? "active";
    this.execution = new InstanceExecution(identity);
  }

  get state(): InstanceState {
    return this.currentState;
  }

  get isStopped(): boolean {
    return this.currentState === "stopped";
  }

  get quiescing(): AbortSignal {
    return this.execution.quiescing;
  }

  get forcedAbort(): AbortSignal {
    return this.execution.forcedAbort;
  }

  own<T extends RuntimeResource>(resource: T): T {
    if (this.currentState !== "new") {
      throw new InstanceUnavailableError(this.identity, this.currentState);
    }
    if (
      this.members.some(
        (member) => member.kind === "resource" && member.resource.id === resource.id,
      )
    ) {
      throw new Error(`resource '${resource.id}' already belongs to '${this.identity}'`);
    }
    this.members.push({ kind: "resource", resource, started: false });
    return resource;
  }

  /** Atomically creates one child component. Failed construction/startup releases everything owned
   * by the provisional child and leaves it undiscoverable to the caller. */
  async mount<T>(
    identity: string,
    create: (instance: RuntimeInstance) => T | Promise<T>,
  ): Promise<MountedComponent<T>> {
    if (!this.acceptsChildren()) {
      throw new InstanceUnavailableError(this.identity, this.currentState);
    }
    if (
      this.members.some(
        (member) =>
          member.kind === "child" && member.child.identity === identity && !member.child.isStopped,
      )
    ) {
      throw new Error(`component '${identity}' already belongs to '${this.identity}'`);
    }
    const child = new RuntimeInstance(identity, this);
    const member: OwnedMember = { kind: "child", child };
    this.members.push(member);
    try {
      const api = await create(child);
      if (this.currentState === "active") {
        await child.start();
      }
      return {
        instance: child,
        api,
      };
    } catch (error) {
      await child.stop({
        reason: { kind: "startup-failure", message: toError(error).message },
        checkpoint: false,
      });
      this.detach(child);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.currentState !== "new") {
      return;
    }
    this.currentState = "starting";
    try {
      for (const member of this.members) {
        if (member.kind === "child") {
          await member.child.start();
        } else {
          await member.resource.start?.(this);
          member.started = true;
        }
      }
      this.currentState = "active";
    } catch (error) {
      await this.stop({
        reason: { kind: "startup-failure", message: toError(error).message },
        checkpoint: false,
      });
      throw error;
    }
  }

  spawn(name: string, task: (quiescing: AbortSignal) => Promise<void>): void {
    this.assertAcceptingWork();
    this.execution.spawn(name, task);
  }

  run<T>(name: string, operation: (forcedAbort: AbortSignal) => Promise<T>): Promise<T> {
    this.assertAcceptingWork();
    return this.execution.run(name, operation);
  }

  onStopped(listener: () => void): () => void {
    return this.stopNotifier.listen(listener);
  }

  setDeviceState(state: DeviceState): void {
    this.deviceState = state;
    for (const member of this.members) {
      if (member.kind === "child") {
        member.child.setDeviceState(state);
      } else if (member.started) {
        member.resource.onDeviceState?.(state);
      }
    }
  }

  getDeviceState(): DeviceState {
    return this.deviceState;
  }

  stop(options: StopOptions = {}): Promise<StopReport> {
    this.stopPromise ??= this.stopOnce(options);
    return this.stopPromise;
  }

  private async stopOnce(options: StopOptions): Promise<StopReport> {
    const reason = options.reason ?? { kind: "requested" };
    const errors: Error[] = [];
    await this.quiesceOwned(reason, errors);
    this.setOwnedState("draining");
    const drained = await this.waitForOwnedWork(options.drainTimeoutMs ?? this.drainTimeoutMs);
    let forced = false;
    if (!drained) {
      forced = true;
      this.abortOwnedWork();
      await this.waitForOwnedWork(options.abortTimeoutMs ?? this.abortTimeoutMs);
    }
    errors.push(...this.ownedBackgroundErrors());
    const abandonedOperations = this.ownedWorkNames();
    const checkpoint = options.checkpoint ?? true;
    if (!forced && abandonedOperations.length === 0 && checkpoint) {
      this.setOwnedState("checkpointing");
      await this.checkpointOwned(errors);
    }
    this.setOwnedState("stopping");
    await this.releaseOwned(errors);
    this.currentState = "stopped";
    this.notifyStopped(errors);
    this.owner?.detach(this);
    return {
      graceful: checkpoint && !forced && errors.length === 0,
      dirty: !checkpoint || forced || errors.length > 0,
      errors,
      abandonedOperations,
    };
  }

  private async quiesceOwned(reason: StopReason, errors: Error[]): Promise<void> {
    if (
      this.currentState !== "new" &&
      this.currentState !== "starting" &&
      this.currentState !== "active"
    ) {
      return;
    }
    this.currentState = "quiescing";
    this.execution.closeAdmission(reason);
    for (const member of [...this.members].reverse()) {
      if (member.kind === "child") {
        await member.child.quiesceOwned({ kind: "owner", message: reason.message }, errors);
      } else if (member.started) {
        await invoke(() => member.resource.quiesce?.(reason), errors);
      }
    }
  }

  private async checkpointOwned(errors: Error[]): Promise<void> {
    for (const member of this.members) {
      if (member.kind === "child") {
        await member.child.checkpointOwned(errors);
      } else if (member.started) {
        await invoke(() => member.resource.checkpoint?.(), errors);
      }
    }
  }

  private async releaseOwned(errors: Error[]): Promise<void> {
    if (this.released) {
      return;
    }
    this.released = true;
    for (const member of [...this.members].reverse()) {
      if (member.kind === "child") {
        await member.child.releaseOwned(errors);
        member.child.currentState = "stopped";
        member.child.notifyStopped(errors);
      } else {
        // Acquisition establishes ownership immediately, so even a never-started resource is released
        // during construction rollback.
        await invoke(() => member.resource.release?.(), errors);
      }
    }
    this.members.length = 0;
  }

  private notifyStopped(errors: Error[]): void {
    this.stopNotifier.notify(errors);
  }

  private detach(child: RuntimeInstance): void {
    const index = this.members.findIndex(
      (member) => member.kind === "child" && member.child === child,
    );
    if (index >= 0) {
      this.members.splice(index, 1);
    }
  }

  private async waitForOwnedWork(timeoutMs: number): Promise<boolean> {
    return waitForWork(this.ownedWorkPromises(), timeoutMs);
  }

  private ownedWorkPromises(): Promise<void>[] {
    return [
      ...this.execution.promises(),
      ...this.childInstances().flatMap((child) => child.ownedWorkPromises()),
    ];
  }

  private ownedWorkNames(): string[] {
    return [
      ...this.execution.names(),
      ...this.childInstances().flatMap((child) => child.ownedWorkNames()),
    ];
  }

  private ownedBackgroundErrors(): Error[] {
    return [
      ...this.execution.errors(),
      ...this.childInstances().flatMap((child) => child.ownedBackgroundErrors()),
    ];
  }

  private abortOwnedWork(): void {
    this.execution.force();
    for (const child of this.childInstances()) {
      child.abortOwnedWork();
    }
  }

  private setOwnedState(state: InstanceState): void {
    if (this.currentState !== "stopped") {
      this.currentState = state;
    }
    for (const child of this.childInstances()) {
      child.setOwnedState(state);
    }
  }

  private childInstances(): RuntimeInstance[] {
    return this.members.flatMap((member) => (member.kind === "child" ? [member.child] : []));
  }

  private acceptsChildren(): boolean {
    return (
      this.currentState === "new" ||
      this.currentState === "starting" ||
      this.currentState === "active"
    );
  }

  private assertAcceptingWork(): void {
    if (this.currentState !== "starting" && this.currentState !== "active") {
      throw new InstanceUnavailableError(this.identity, this.currentState);
    }
  }
}
