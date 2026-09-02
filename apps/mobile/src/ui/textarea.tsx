import type { TextInputProps } from 'react-native';

import { Input } from './input';

export function Textarea(properties: TextInputProps) {
  return (
    <Input
      multiline
      numberOfLines={properties.numberOfLines ?? 4}
      textAlignVertical="top"
      {...properties}
    />
  );
}
