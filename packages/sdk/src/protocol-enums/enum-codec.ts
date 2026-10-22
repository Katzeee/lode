export type ProtocolEnumCodec<Protocol extends number, Domain extends string> = Readonly<{
  values: readonly Domain[];
  encode(value: Domain): Protocol;
  decode(value: Protocol): Domain;
}>;

export type DomainEnum<Codec extends ProtocolEnumCodec<number, string>> = ReturnType<Codec["decode"]>;

type KebabCase<Name extends string> = Name extends `${infer Head}_${infer Tail}`
  ? `${Lowercase<Head>}-${KebabCase<Tail>}`
  : Lowercase<Name>;

type CamelCase<Name extends string> = Name extends `${infer Head}_${infer Tail}`
  ? `${Lowercase<Head>}${CamelTail<Tail>}`
  : Lowercase<Name>;
type CamelTail<Name extends string> = Name extends `${infer Head}_${infer Tail}`
  ? `${Capitalize<Lowercase<Head>>}${CamelTail<Tail>}`
  : Capitalize<Lowercase<Name>>;

type ProtocolEnumObject = Readonly<Record<string, string | number>>;
type MemberNames<ProtocolEnum extends ProtocolEnumObject> = Exclude<
  keyof ProtocolEnum & string,
  "UNSPECIFIED" | `${number}`
>;

/**
 * Derives the domain codec for a generated protobuf-es enum: every member name maps to its
 * kebab-case form, and UNSPECIFIED never reaches the domain. The correspondence is total by
 * construction, so a proto enum member can never silently miss its domain name.
 */
export function protocolEnum<const ProtocolEnum extends ProtocolEnumObject>(
  protocolEnumObject: ProtocolEnum,
  label: string,
): ProtocolEnumCodec<ProtocolEnum[keyof ProtocolEnum] & number, KebabCase<MemberNames<ProtocolEnum>>> {
  return buildCodec(protocolEnumObject, label, (name) => name.toLowerCase().replaceAll("_", "-"));
}

/** As {@link protocolEnum}, for enums whose domain names are camelCase (projection sections). */
export function protocolEnumCamel<const ProtocolEnum extends ProtocolEnumObject>(
  protocolEnumObject: ProtocolEnum,
  label: string,
): ProtocolEnumCodec<ProtocolEnum[keyof ProtocolEnum] & number, CamelCase<MemberNames<ProtocolEnum>>> {
  return buildCodec(protocolEnumObject, label, (name) => {
    const [head = "", ...tail] = name.toLowerCase().split("_");
    return `${head}${tail.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")}`;
  });
}

function buildCodec<Protocol extends number, Domain extends string>(
  protocolEnumObject: ProtocolEnumObject,
  label: string,
  domainName: (memberName: string) => string,
): ProtocolEnumCodec<Protocol, Domain> {
  const byDomain = new Map<string, Protocol>();
  const byProtocol = new Map<number, Domain>();
  const values: Domain[] = [];
  for (const [name, value] of Object.entries(protocolEnumObject)) {
    // Numeric-enum objects also carry reverse (number → name) entries; skip those and UNSPECIFIED.
    if (typeof value !== "number" || name === "UNSPECIFIED") {
      continue;
    }
    const domain = domainName(name) as Domain;
    byDomain.set(domain, value as Protocol);
    byProtocol.set(value, domain);
    values.push(domain);
  }
  return {
    values,
    encode(value) {
      const encoded = byDomain.get(value);
      if (encoded === undefined) {
        throw new Error(`${label} is invalid: ${value}`);
      }
      return encoded;
    },
    decode(value) {
      const decoded = byProtocol.get(value);
      if (decoded === undefined) {
        throw new Error(`${label} is unspecified or unrecognized`);
      }
      return decoded;
    },
  };
}
