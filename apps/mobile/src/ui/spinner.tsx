import { ActivityIndicator } from 'react-native';

import { useColors } from './theme';

export function Spinner({ color }: Readonly<{ color?: string }>) {
  const colors = useColors();
  return <ActivityIndicator color={color ?? colors.primary} size="small" />;
}
