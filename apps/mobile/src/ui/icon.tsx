import type { IconName } from '@lode/design-system-catalog';
import AppWindow from 'lucide-react-native/icons/app-window';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import Copy from 'lucide-react-native/icons/copy';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import House from 'lucide-react-native/icons/house';
import Layers from 'lucide-react-native/icons/layers';
import LayoutTemplate from 'lucide-react-native/icons/layout-template';
import MessagesSquare from 'lucide-react-native/icons/messages-square';
import Moon from 'lucide-react-native/icons/moon';
import MousePointerClick from 'lucide-react-native/icons/mouse-pointer-click';
import Palette from 'lucide-react-native/icons/palette';
import Pencil from 'lucide-react-native/icons/pencil';
import Shapes from 'lucide-react-native/icons/shapes';
import Sun from 'lucide-react-native/icons/sun';
import SunMoon from 'lucide-react-native/icons/sun-moon';
import TextCursorInput from 'lucide-react-native/icons/text-cursor-input';
import Trash from 'lucide-react-native/icons/trash-2';
import Type from 'lucide-react-native/icons/type';
import X from 'lucide-react-native/icons/x';
import { tokens } from '@lode/design-tokens';

import { useColors, type ColorRole } from './theme';

const icons = {
  'app-window': AppWindow,
  check: Check,
  'chevron-down': ChevronDown,
  'circle-alert': CircleAlert,
  copy: Copy,
  ellipsis: Ellipsis,
  house: House,
  layers: Layers,
  'layout-template': LayoutTemplate,
  'messages-square': MessagesSquare,
  moon: Moon,
  'mouse-pointer-click': MousePointerClick,
  palette: Palette,
  pencil: Pencil,
  shapes: Shapes,
  sun: Sun,
  'sun-moon': SunMoon,
  'text-cursor-input': TextCursorInput,
  trash: Trash,
  type: Type,
  x: X,
} satisfies Readonly<Record<IconName, typeof AppWindow>>;

const sizes = {
  sm: tokens.space.md,
  md: tokens.space.lg,
  lg: tokens.space.xl,
} as const;

export function Icon({
  color = 'foreground',
  label,
  name,
  size = 'md',
}: Readonly<{
  color?: ColorRole;
  label?: string;
  name: IconName;
  size?: keyof typeof sizes;
}>) {
  const colors = useColors();
  const Component = icons[name];
  return (
    <Component
      accessibilityElementsHidden={label === undefined}
      accessibilityLabel={label}
      accessibilityRole={label === undefined ? undefined : 'image'}
      color={colors[color]}
      importantForAccessibility={label === undefined ? 'no' : 'yes'}
      size={sizes[size]}
    />
  );
}
