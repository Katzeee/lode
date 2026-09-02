import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { tokens } from '@lode/design-tokens';

export type ThemeMode = 'light' | 'dark';
export type AccentName = keyof typeof tokens.color.accent;
export const accentNames = Object.keys(
  tokens.color.accent,
) as readonly AccentName[];

type Theme = Readonly<{ accent: AccentName; mode: ThemeMode }>;

const ThemeContext = createContext<Theme>({ accent: 'forest', mode: 'light' });

export function ThemeProvider({
  accent,
  children,
  mode,
}: Readonly<{ accent?: AccentName; children: ReactNode; mode: ThemeMode }>) {
  const inherited = useContext(ThemeContext);
  const theme = useMemo(
    () => ({ accent: accent ?? inherited.accent, mode }),
    [accent, inherited.accent, mode],
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
  const { accent, mode } = useContext(ThemeContext);
  return useMemo(
    () => ({ ...tokens.color.sys[mode], ...tokens.color.accent[accent][mode] }),
    [accent, mode],
  );
}

export function withAlpha(hex: string, alpha: number): string {
  const channel = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${channel}`;
}
