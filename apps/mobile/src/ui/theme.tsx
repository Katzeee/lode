import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { tokens } from '@lode/design-tokens';

export type ThemeMode = 'light' | 'dark';
export type ThemeName = keyof typeof tokens.theme;
export const themeNames = Object.keys(tokens.theme) as readonly ThemeName[];

type Theme = Readonly<{ mode: ThemeMode; name: ThemeName }>;

const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({
  children,
  mode,
  name,
}: Readonly<{ children: ReactNode; mode?: ThemeMode; name?: ThemeName }>) {
  const inherited = useContext(ThemeContext);
  const systemMode = useColorScheme();
  const theme = useMemo(
    () => ({
      mode: mode ?? inherited?.mode ?? systemMode ?? 'light',
      name: name ?? inherited?.name ?? 'forest',
    }),
    [inherited?.mode, inherited?.name, mode, name, systemMode],
  );
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

export function useThemeMode(): ThemeMode {
  return useTheme().mode;
}

export function useThemeName(): ThemeName {
  return useTheme().name;
}

export type ThemeColors = Readonly<
  Record<keyof (typeof tokens.color.sys)['light'], string>
>;
export type ColorRole = keyof ThemeColors;

export function useColors(): ThemeColors {
  const { mode, name } = useTheme();
  return useMemo(
    () => ({ ...tokens.color.sys[mode], ...tokens.theme[name].color[mode] }),
    [mode, name],
  );
}

function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === undefined) {
    throw new Error('Theme components must render inside ThemeProvider');
  }
  return theme;
}

export function withAlpha(hex: string, alpha: number): string {
  const channel = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${channel}`;
}
