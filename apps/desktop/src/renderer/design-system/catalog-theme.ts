import { tokens } from "@lode/design-tokens";
import { createContext, useContext } from "react";

export type CatalogMode = "light" | "dark";
export type ThemeName = keyof typeof tokens.theme;
export const themeNames = Object.keys(tokens.theme) as readonly ThemeName[];

export const CatalogModeContext = createContext<CatalogMode>("light");

export function useCatalogMode(): CatalogMode {
  return useContext(CatalogModeContext);
}

const userThemeStyleId = "lode-user-theme";

// A user theme is plain CSS loaded after the token stylesheet; overriding the
// documented --lode-* variables is the entire contract, and nothing stops a
// stylesheet from going further — that freedom is deliberately unguaranteed.
export function applyUserTheme(css: string): void {
  let element = document.getElementById(userThemeStyleId);
  if (element === null) {
    element = document.createElement("style");
    element.id = userThemeStyleId;
    document.head.append(element);
  }
  element.textContent = css;
}

export function clearUserTheme(): void {
  document.getElementById(userThemeStyleId)?.remove();
}
