import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { tokens } from '@lode/design-tokens';

export type ThemeMode = 'light' | 'dark';
export type ThemeName = keyof typeof tokens.theme;
export const themeNames = Object.keys(tokens.theme) as readonly ThemeName[];

type Theme = Readonly<{ mode: ThemeMode; name: ThemeName }>;

const ThemeContext = createContext<Theme>({ mode: 'light', name: 'forest' });

export function ThemeProvider({
  children,
  mode,
  name,
}: Readonly<{ children: ReactNode; mode: ThemeMode; name?: ThemeName }>) {
  const inherited = useContext(ThemeContext);
  const theme = useMemo(
    () => ({ mode, name: name ?? inherited.name }),
    [inherited.name, mode, name],
  );
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

export function useThemeMode(): ThemeMode {
  return useContext(ThemeContext).mode;
}

export type ThemeColors = Readonly<
  Record<keyof (typeof tokens.color.sys)['light'], string>
>;
export type ColorRole = keyof ThemeColors;

export function useColors(): ThemeColors {
  const { mode, name } = useContext(ThemeContext);
  return useMemo(
    () => ({ ...tokens.color.sys[mode], ...tokens.theme[name].color[mode] }),
    [mode, name],
  );
}

export function withAlpha(hex: string, alpha: number): string {
  const channel = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${channel}`;
}
