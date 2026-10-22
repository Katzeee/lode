type DaemonArgs = Readonly<{
  listen?: string;
  exchangeListen?: string;
  dataRoot?: string;
  home?: string;
  homeName?: string;
  accessToken?: string;
}>;

export function parseDaemonArgs(argv: string[]): DaemonArgs {
  return {
    ...optionalValue(argv, "--listen", "listen"),
    ...optionalValue(argv, "--exchange-listen", "exchangeListen"),
    ...optionalValue(argv, "--data-root", "dataRoot"),
    ...optionalValue(argv, "--home", "home"),
    ...optionalValue(argv, "--home-name", "homeName"),
    ...optionalValue(argv, "--access-token", "accessToken"),
  };
}

function optionalValue<K extends string>(argv: readonly string[], flag: string, key: K): Partial<Record<K, string>> {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return {};
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return { [key]: value } as Partial<Record<K, string>>;
}
