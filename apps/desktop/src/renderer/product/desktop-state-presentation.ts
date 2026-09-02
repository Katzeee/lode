import type { DesktopState } from "../../bridge/contract.cjs";

export function authorityText(authority: DesktopState["authority"]): string {
  switch (authority) {
    case "none":
      return "Authority pending";
    case "starting":
      return "Connecting";
    case "owned":
      return "Desktop-owned daemon";
    case "reused":
      return "Shared daemon";
  }
}

export function shortIdentity(identity: string): string {
  return identity.length <= 14 ? identity : `${identity.slice(0, 6)}…${identity.slice(-6)}`;
}
