export type ProtocolEnumCodec<Protocol extends number, Domain extends string> = Readonly<{
  values: readonly Domain[];
  encode(value: Domain): Protocol;
  decode(value: Protocol): Domain;
}>;

export type DomainEnum<Codec extends ProtocolEnumCodec<number, string>> = ReturnType<Codec["decode"]>;

export function defineProtocolEnum<Protocol extends number>() {
  return <const Domain extends string>(
    mapping: Readonly<Record<Protocol, Domain | null>>,
    label: string,
  ): ProtocolEnumCodec<Protocol, Domain> => ({
    values: Object.values(mapping).filter((value): value is Domain => value !== null),
    encode(value) {
      for (const [protocol, domain] of Object.entries(mapping)) {
        if (domain === value) {
          return Number(protocol) as Protocol;
        }
      }
      throw new Error(`${label} is invalid: ${value}`);
    },
    decode(value) {
      const decoded = mapping[value];
      if (decoded === null || decoded === undefined) {
        throw new Error(`${label} is unspecified or unrecognized`);
      }
      return decoded;
    },
  });
}
