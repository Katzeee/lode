import { createContext, useContext, type ReactNode } from 'react';
import { tokens } from '@lode/design-tokens';

export type ThemeMode = 'light' | 'dark';

const ThemeContext = createContext<ThemeMode>('light');

export function ThemeProvider({
  children,
  mode,
}: Readonly<{ children: ReactNode; mode: ThemeMode }>) {
  return <ThemeContext.Provider value={mode}>{children}</ThemeContext.Provider>;
}

export function useThemeMode(): ThemeMode {
  return useContext(ThemeContext);
}

export type ThemeColors = (typeof tokens.color.sys)[ThemeMode];
export type ColorRole = keyof ThemeColors;

export function useColors(): ThemeColors {
  return tokens.color.sys[useContext(ThemeContext)];
}

export function withAlpha(hex: string, alpha: number): string {
  const channel = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${channel}`;
}
