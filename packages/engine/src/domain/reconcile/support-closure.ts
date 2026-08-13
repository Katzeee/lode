export function supportClosure(
  targets: readonly string[],
  supportByContribution: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const closure = new Set(targets);
  const queue = [...targets];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const support of supportByContribution.get(current) ?? []) {
      if (closure.has(support)) {
        continue;
      }
      closure.add(support);
      queue.push(support);
    }
  }
  return [...closure].sort();
}
