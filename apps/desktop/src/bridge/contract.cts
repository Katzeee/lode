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

export const desktopChannels = Object.freeze({ request: "lode:application-request", event: "lode:application-event" });
