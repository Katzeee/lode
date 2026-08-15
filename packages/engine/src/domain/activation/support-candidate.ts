export function addIfPresent(target: Set<string>, value: string | undefined): void {
  if (value !== undefined) {
    target.add(value);
  }
}

export function addCandidate(target: Map<string, string[]>, identity: string, factId: string): void {
  const candidates = target.get(identity) ?? [];
  candidates.push(factId);
  target.set(identity, candidates);
}

export function effectiveCandidate(
  candidatesByIdentity: ReadonlyMap<string, readonly string[]>,
  identity: string,
  viable: ReadonlySet<string>,
): string | undefined {
  const candidates = candidatesByIdentity.get(identity);
  return candidates?.find((candidate) => viable.has(candidate)) ?? candidates?.[0];
}
