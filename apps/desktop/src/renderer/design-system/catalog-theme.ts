import { tokens } from "@lode/design-tokens";
import { createContext, useContext } from "react";

export type CatalogTheme = "light" | "dark";
export type AccentName = keyof typeof tokens.color.accent;
export const accentNames = Object.keys(tokens.color.accent) as readonly AccentName[];

export const CatalogThemeContext = createContext<CatalogTheme>("light");

export function useCatalogTheme(): CatalogTheme {
  return useContext(CatalogThemeContext);
}
