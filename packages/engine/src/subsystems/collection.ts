import { type AnyEngineSubsystemDefinition, type CapabilitySet } from "./definition.js";
import type { EngineSubsystemControl, EngineSubsystemProduct } from "./subsystem.js";

type SubsystemNode = {
  readonly product: EngineSubsystemProduct<unknown>;
  initBegun: boolean;
  stopped: boolean;
};

type ErasedDefinition = AnyEngineSubsystemDefinition;
type ErasedFactory = (
  dependencies: Readonly<Record<string, unknown>>,
  control: EngineSubsystemControl,
) => EngineSubsystemProduct<unknown>;
type StopSignal = { requested: boolean };

class EngineSubsystemCollectionStoppedError extends Error {
  constructor() {
    super("Engine subsystem collection is stopping or stopped");
    this.name = "EngineSubsystemCollectionStoppedError";
  }
}

class EngineSubsystemLifecycleError extends Error {
  readonly primary: Error;
  readonly cleanupErrors: readonly Error[];

  constructor(primary: Error, cleanupErrors: readonly Error[] = []) {
    super(
      cleanupErrors.length > 0
        ? `Engine subsystem startup failed: ${primary.message}; ${cleanupErrors.length} rollback operation(s) failed`
        : `Engine subsystem startup failed: ${primary.message}`,
      { cause: primary },
    );
    this.name = "EngineSubsystemLifecycleError";
    this.primary = primary;
    this.cleanupErrors = cleanupErrors;
  }
}

class EngineSubsystemCollection {
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;
  private rollbackFailure: EngineSubsystemLifecycleError | undefined;

  constructor(
    private readonly nodes: readonly SubsystemNode[],
    private readonly stopSignal: StopSignal,
  ) {}

  start(): Promise<void> {
    if (this.stopSignal.requested) {
      return Promise.reject(new EngineSubsystemCollectionStoppedError());
    }
    return (this.startPromise ??= Promise.resolve().then(async () => this.startOnce()));
  }

  stop(): Promise<void> {
    this.stopSignal.requested = true;
    return (this.stopPromise ??= Promise.resolve().then(async () => this.stopOnce()));
  }

  private async startOnce(): Promise<void> {
    try {
      for (const node of this.nodes) {
        this.assertStartupContinues();
        node.initBegun = true;
        await node.product.init?.();
      }
      for (const node of this.nodes) {
        this.assertStartupContinues();
        await node.product.start?.();
      }
      this.assertStartupContinues();
    } catch (error) {
      const primary = toError(error);
      this.stopSignal.requested = true;
      const cleanupErrors = await this.stopInitialized();
      if (cleanupErrors.length > 0) {
        const failure = new EngineSubsystemLifecycleError(primary, cleanupErrors);
        this.rollbackFailure = failure;
        throw failure;
      }
      throw new EngineSubsystemLifecycleError(primary);
    }
  }

  private assertStartupContinues(): void {
    if (this.stopSignal.requested) {
      throw new EngineSubsystemCollectionStoppedError();
    }
  }

  private async stopOnce(): Promise<void> {
    // The start caller owns its already-delivered primary failure. Stop waits
    // only so it can report the separately owned rollback outcome below.
    await this.startPromise?.catch(() => undefined);
    if (this.rollbackFailure) {
      throw this.rollbackFailure;
    }
    const failures = await this.stopInitialized();
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, "Engine subsystems failed to stop cleanly");
    }
  }

  private async stopInitialized(): Promise<readonly Error[]> {
    const failures: Error[] = [];
    for (const node of [...this.nodes].reverse()) {
      if (!node.initBegun || node.stopped) {
        continue;
      }
      try {
        await node.product.stop?.();
      } catch (error) {
        failures.push(toError(error));
      } finally {
        node.stopped = true;
      }
    }
    return failures;
  }
}

export function buildEngineSubsystems<const Definitions extends readonly AnyEngineSubsystemDefinition[], Api>(
  definitions: Definitions,
  createApi: (capabilities: CapabilitySet<Definitions>) => Api,
): Readonly<{ lifecycle: EngineSubsystemCollection; api: Api }> {
  const ordered = orderDefinitions(definitions);
  const products = new Map<ErasedDefinition, EngineSubsystemProduct<unknown>>();
  const capabilities: Record<string, unknown> = {};
  const nodes: SubsystemNode[] = [];
  const stopSignal: StopSignal = { requested: false };
  const control: EngineSubsystemControl = Object.freeze({
    get stopRequested() {
      return stopSignal.requested;
    },
  });

  for (const definition of ordered) {
    const dependencies = Object.fromEntries(
      dependencyEntries(definition).map(([role, dependency]) => [role, products.get(dependency)?.capability]),
    );
    const product = (definition.create as ErasedFactory)(Object.freeze(dependencies), control);
    products.set(definition, product);
    capabilities[definition.id] = product.capability;
    nodes.push({
      product,
      initBegun: false,
      stopped: false,
    });
  }

  return {
    lifecycle: new EngineSubsystemCollection(nodes, stopSignal),
    api: createApi(Object.freeze(capabilities) as CapabilitySet<Definitions>),
  };
}

function orderDefinitions(definitions: readonly ErasedDefinition[]): readonly ErasedDefinition[] {
  assertDefinitions(definitions);
  const included = new Set(definitions);
  const visiting = new Set<ErasedDefinition>();
  const visited = new Set<ErasedDefinition>();
  const ordered: ErasedDefinition[] = [];

  const visit = (definition: ErasedDefinition, path: readonly string[]): void => {
    if (visited.has(definition)) {
      return;
    }
    if (visiting.has(definition)) {
      throw new Error(`Engine subsystem dependency cycle: ${[...path, definition.id].join(" -> ")}`);
    }
    visiting.add(definition);
    for (const dependency of dependencyEntries(definition).map(([, value]) => value)) {
      if (!included.has(dependency)) {
        throw new Error(`Engine subsystem '${definition.id}' has unknown dependency '${dependency.id}'`);
      }
      visit(dependency, [...path, definition.id]);
    }
    visiting.delete(definition);
    visited.add(definition);
    ordered.push(definition);
  };

  for (const definition of definitions) {
    visit(definition, []);
  }
  return ordered;
}

function assertDefinitions(definitions: readonly ErasedDefinition[]): void {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      throw new Error(`Duplicate Engine subsystem id '${definition.id}'`);
    }
    ids.add(definition.id);
  }
}

function dependencyEntries(definition: ErasedDefinition): readonly [string, ErasedDefinition][] {
  return Object.entries(definition.dependencies) as [string, ErasedDefinition][];
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
