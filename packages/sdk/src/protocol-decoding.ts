export function required<Value>(value: Value | null | undefined, label: string): Value {
  if (value === null || value === undefined) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

/** Narrows a protobuf-es oneof group to its selected member, rejecting unset groups. */
export function selectedCase<Group extends Readonly<{ case?: string | undefined }>>(
  group: Group | null | undefined,
  label: string,
): Exclude<Group, Readonly<{ case?: undefined }>> {
  if (group === null || group === undefined || group.case === undefined) {
    throw new Error(`${label} is missing`);
  }
  return group as Exclude<Group, Readonly<{ case?: undefined }>>;
}

export function unsupportedProtocolCase(value: never, label: string): never {
  const protocolCase = (value as Readonly<{ case?: unknown }>).case;
  throw new Error(`${label} has unsupported case ${String(protocolCase)}`);
}

export function unsupportedProtocolValue(value: never, label: string): never {
  throw new Error(`${label} has unsupported value ${String(value)}`);
}
