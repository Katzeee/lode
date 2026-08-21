export function deliverListeners<T>(
  listeners: ReadonlySet<(value: T) => void>,
  value: T,
  copy?: (value: T) => T,
): void {
  for (const listener of listeners) {
    try {
      listener(copy ? copy(value) : value);
    } catch {
      continue;
    }
  }
}
