export type DesktopPhase = "initializing" | "ready" | "locked" | "error";
export type AuthorityOwnership = "none" | "starting" | "owned" | "reused";

export type DesktopActor = Readonly<{
  actorId: string;
  label: string;
  unlocked: boolean;
}>;

export type DesktopWorkspace = Readonly<{
  workspaceId: string;
  label: string;
}>;

export type DesktopState = Readonly<{
  phase: DesktopPhase;
  headline: string;
  detail: string;
  home: Readonly<{ name: string; path: string }> | null;
  authority: AuthorityOwnership;
  actors: readonly DesktopActor[];
  workspaces: readonly DesktopWorkspace[];
  notice: string | null;
  error: string | null;
}>;

export type InitializeHomeInput = Readonly<{
  actorLabel: string;
  passphrase: string;
  workspaceLabel: string;
}>;

export type InitializeHomeResult = Readonly<{
  recoveryPhrase: string;
  state: DesktopState;
}>;

export type DesktopBridge = Readonly<{
  getState(): Promise<DesktopState>;
  initializeHome(input: InitializeHomeInput): Promise<InitializeHomeResult>;
  unlockVault(passphrase: string): Promise<DesktopState>;
  createWorkspace(label: string): Promise<DesktopState>;
  onStateChanged(listener: (state: DesktopState) => void): () => void;
}>;

export const desktopChannels = Object.freeze({
  state: "lode:state",
  initializeHome: "lode:initialize-home",
  unlockVault: "lode:unlock-vault",
  createWorkspace: "lode:create-workspace",
  stateChanged: "lode:state-changed",
});

export function parseInitializeHomeInput(value: unknown): InitializeHomeInput {
  const input = record(value, "Home initialization");
  exactKeys(input, ["actorLabel", "passphrase", "workspaceLabel"], "Home initialization");
  return {
    actorLabel: requiredText(input["actorLabel"], "Actor label", 80),
    passphrase: requiredText(input["passphrase"], "Vault passphrase", 512),
    workspaceLabel: requiredText(input["workspaceLabel"], "Workspace label", 120),
  };
}

export function parsePassphrase(value: unknown): string {
  return requiredText(value, "Vault passphrase", 512);
}

export function parseWorkspaceLabel(value: unknown): string {
  return requiredText(value, "Workspace label", 120);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !(key in value))) {
    throw new Error(`${name} has an invalid shape`);
  }
}

function requiredText(value: unknown, name: string, maximumLength: number): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be text`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new Error(`${name} must contain between 1 and ${maximumLength} characters`);
  }
  return normalized;
}
