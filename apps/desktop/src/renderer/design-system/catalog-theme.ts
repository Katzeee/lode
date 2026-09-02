import { createContext, useContext } from "react";

export type CatalogTheme = "light" | "dark";

export const CatalogThemeContext = createContext<CatalogTheme>("light");

export function useCatalogTheme(): CatalogTheme {
  return useContext(CatalogThemeContext);
}
