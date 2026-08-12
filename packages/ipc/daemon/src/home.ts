// One home is one daemon and one isolated workspace registry.

import { homedir, platform } from "node:os";
import { join } from "node:path";

export type LodeHomePaths = {
  data: string;
  endpoint: string;
  logs: string;
};

/** Default home for the platform (Win `%APPDATA%\lode`, macOS `~/Library/Application Support/lode`,
 *  Linux/other-POSIX `${XDG_DATA_HOME:-~/.local/share}/lode`). */
function defaultHome(): string {
  const sys = platform();
  if (sys === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "lode");
  }
  if (sys === "darwin") {
    return join(homedir(), "Library", "Application Support", "lode");
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "lode");
}

/** Resolve the home dir: explicit arg (`--home`) > `LODE_HOME` env > platform default. */
export function resolveLodeHome(argHome?: string): string {
  return argHome ?? process.env.LODE_HOME ?? defaultHome();
}

/** All well-known paths under a home. */
export function homePaths(home: string): LodeHomePaths {
  return {
    data: join(home, "data"),
    endpoint: join(home, "endpoint"),
    logs: join(home, "logs"),
  };
}
