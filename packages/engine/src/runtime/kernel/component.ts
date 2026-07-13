import type { AppRuntime } from "./app-runtime.js";
import { toError } from "./invoke.js";
import type { RuntimeInstance } from "./runtime.js";

export type ComponentContext<Services, Required extends keyof Services & string, Config> = {
  readonly instance: RuntimeInstance;
  readonly config: Config;
  readonly deps: Pick<Services, Required>;
};

export type ComponentDefinition<
  Services,
  Name extends keyof Services & string,
  Required extends keyof Services & string = never,
  Config = unknown,
> = {
  readonly name: Name;
  readonly requires?: readonly Required[];
  create(
    context: ComponentContext<Services, Required, Config>,
  ): Services[Name] | Promise<Services[Name]>;
};

type AnyDefinition<Services, Config> = ComponentDefinition<
  Services,
  keyof Services & string,
  keyof Services & string,
  Config
>;

/** Installs singleton component definitions as children of the runtime root. Creation is dependency
 * ordered and each component is mounted atomically. The resulting dependency graph never controls
 * ownership: all definitions here are explicitly root-owned. */
export async function installComponents<Services, Config>(
  runtime: AppRuntime,
  definitions: readonly AnyDefinition<Services, Config>[],
  config: Config,
): Promise<Services> {
  const services: Record<string, unknown> = {};
  try {
    for (const definition of sortDefinitions(definitions)) {
      const deps = select(definition.requires ?? [], services);
      const mounted = await runtime.root.mount(`component:${definition.name}`, (instance) =>
        definition.create({ instance, config, deps }),
      );
      services[definition.name] = mounted.api;
    }
  } catch (error) {
    await runtime.stop({
      reason: { kind: "startup-failure", message: toError(error).message },
      checkpoint: false,
    });
    throw error;
  }
  return select(
    definitions.map((definition) => definition.name),
    services,
  );
}

function sortDefinitions<Services, Config>(
  definitions: readonly AnyDefinition<Services, Config>[],
): AnyDefinition<Services, Config>[] {
  type Name = keyof Services & string;
  const byName = new Map<Name, AnyDefinition<Services, Config>>(
    definitions.map((definition) => [definition.name, definition]),
  );
  for (const definition of definitions) {
    for (const dependency of definition.requires ?? []) {
      if (!byName.has(dependency)) {
        throw new Error(
          `component '${definition.name}' requires unknown component '${dependency}'`,
        );
      }
    }
  }
  const result: AnyDefinition<Services, Config>[] = [];
  const states = new Map<Name, "visiting" | "done">();
  const visit = (name: Name): void => {
    const state = states.get(name);
    if (state === "done") {
      return;
    }
    if (state === "visiting") {
      throw new Error(`component dependency cycle at '${name}'`);
    }
    states.set(name, "visiting");
    const definition = byName.get(name);
    if (definition !== undefined) {
      for (const dependency of definition.requires ?? []) {
        visit(dependency);
      }
      result.push(definition);
    }
    states.set(name, "done");
  };
  for (const definition of definitions) {
    visit(definition.name);
  }
  return result;
}

function select<Services>(
  names: readonly (keyof Services & string)[],
  services: Record<string, unknown>,
): Services {
  const selected: Record<string, unknown> = {};
  for (const name of names) {
    selected[name] = services[name];
  }
  return selected as Services;
}
