import { Text as NativeText, type TextProps } from 'react-native';
import { tokens } from '@lode/design-tokens';

import { useColors, type ColorRole } from './theme';

export const lodeFontFamily = tokens.font.family.interface[0];
export const lodeCodeFontFamily = tokens.font.family.code[0];

export type TextVariant = keyof typeof tokens.font.size;
type FontWeight = keyof typeof tokens.font.weight;

type LodeTextProperties = TextProps &
  Readonly<{
    color?: ColorRole;
    mono?: boolean;
    variant?: TextVariant;
    weight?: FontWeight;
  }>;

export function Text({
  color = 'foreground',
  mono = false,
  style,
  variant = 'body',
  weight = 'regular',
  ...properties
}: LodeTextProperties) {
  const colors = useColors();
  return (
    <NativeText
      {...properties}
      style={[
        {
          color: colors[color],
          fontFamily: mono ? lodeCodeFontFamily : lodeFontFamily,
          fontSize: tokens.font.size[variant],
          fontWeight: String(tokens.font.weight[weight]) as
            '400' | '500' | '600' | '700',
          lineHeight: tokens.font['line-height'][variant],
        },
        style,
      ]}
    />
  );
}
