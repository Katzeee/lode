import type { EngineSubsystemControl, EngineSubsystemProduct } from "./subsystem.js";

export type EngineSubsystemReference<Capability> = Readonly<{
  id: string;
  capability?: Capability;
}>;

export type EngineSubsystemDependencies = Readonly<Record<string, EngineSubsystemReference<unknown>>>;

type DependencyCapabilities<Dependencies extends EngineSubsystemDependencies> = Readonly<{
  [Role in keyof Dependencies]: Dependencies[Role] extends EngineSubsystemReference<infer Capability>
    ? Capability
    : never;
}>;

export type EngineSubsystemDefinition<
  Id extends string,
  Dependencies extends EngineSubsystemDependencies,
  Capability,
> = EngineSubsystemReference<Capability> &
  Readonly<{
    id: Id;
    dependencies: Dependencies;
    create(
      dependencies: DependencyCapabilities<Dependencies>,
      control: EngineSubsystemControl,
    ): EngineSubsystemProduct<Capability>;
  }>;

export type AnyEngineSubsystemDefinition = Readonly<{
  id: string;
  dependencies: EngineSubsystemDependencies;
  capability?: unknown;
  create(dependencies: never, control: EngineSubsystemControl): EngineSubsystemProduct<unknown>;
}>;

type DefinitionCapability<Definition> =
  Definition extends Readonly<{
    create(dependencies: never, control: EngineSubsystemControl): EngineSubsystemProduct<infer Capability>;
  }>
    ? Capability
    : never;

export type CapabilitySet<Definitions extends readonly AnyEngineSubsystemDefinition[]> = Readonly<{
  [Definition in Definitions[number] as Definition["id"]]: DefinitionCapability<Definition>;
}>;

export function defineEngineSubsystem<
  const Id extends string,
  const Dependencies extends EngineSubsystemDependencies,
  Capability,
>(
  definition: EngineSubsystemDefinition<Id, Dependencies, Capability>,
): EngineSubsystemDefinition<Id, Dependencies, Capability> {
  return definition;
}
