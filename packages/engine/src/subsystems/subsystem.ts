export type EngineSubsystemControl = Readonly<{
  stopRequested: boolean;
}>;

type EngineSubsystemHooks = Readonly<{
  init?(): void | Promise<void>;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}>;

export type EngineSubsystemProduct<Capability> = EngineSubsystemHooks &
  Readonly<{
    capability: Capability;
  }>;
