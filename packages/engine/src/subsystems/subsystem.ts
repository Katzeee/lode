export type EngineSubsystemControl = Readonly<{
  stopRequested: boolean;
}>;

export type EngineSubsystemHooks = Readonly<{
  init?(): void | Promise<void>;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}>;

export type EngineSubsystemProduct<Capability> = EngineSubsystemHooks &
  Readonly<{
    capability: Capability;
  }>;
