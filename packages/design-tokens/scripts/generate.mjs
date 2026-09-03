import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(packageRoot, "tokens/lode.tokens.json");
const harmonyFontPath = resolve(packageRoot, "assets/fonts/HarmonyOS_Sans_SC.ttf");
const harmonyLicensePath = resolve(packageRoot, "assets/legal/HarmonyOS Sans/LICENSE-update.txt");
const generatedPath = resolve(packageRoot, "src/generated.ts");
const sourceOnly = process.argv.includes("--source-only");
const document = JSON.parse(await readFile(sourcePath, "utf8"));
const harmonyFont = await readFile(harmonyFontPath);
const harmonyLicense = await readFile(harmonyLicensePath, "utf8");
const harmonyFontHash = createHash("sha256").update(harmonyFont).digest("hex").toUpperCase();
if (harmonyFontHash !== "8978E05044E7089AD6A9DE38C505C8148305607983487435A916D2610700A7CA") {
  throw new Error("HarmonyOS Sans SC must remain byte-identical to the pinned official v2.040 asset");
}
const tokens = new Map();

visit(document, [], undefined);
const resolved = {};
for (const [path, token] of tokens) {
  setPath(resolved, path.split("."), platformValue(resolveValue(token.value, []), token.type));
}

// Shadows are a web-only rendering concern (React Native has its own elevation
// model), so they live in the generator's emission rather than the token JSON.
const shadows = {
  light: {
    xs: "0 1px 2px rgb(23 26 23 / 0.05)",
    sm: "0 1px 2px rgb(23 26 23 / 0.05), 0 2px 8px -2px rgb(23 26 23 / 0.07)",
    md: "0 2px 4px rgb(23 26 23 / 0.05), 0 12px 32px -8px rgb(23 26 23 / 0.14)",
    lg: "0 4px 8px rgb(23 26 23 / 0.06), 0 24px 56px -12px rgb(23 26 23 / 0.22)",
  },
  dark: {
    xs: "0 1px 2px rgb(0 0 0 / 0.35)",
    sm: "0 1px 2px rgb(0 0 0 / 0.35), 0 2px 10px -2px rgb(0 0 0 / 0.4)",
    md: "0 2px 4px rgb(0 0 0 / 0.4), 0 12px 32px -8px rgb(0 0 0 / 0.55)",
    lg: "0 4px 8px rgb(0 0 0 / 0.45), 0 24px 56px -12px rgb(0 0 0 / 0.7)",
  },
};

const modes = systemModes(resolved);
const namedThemes = requiredRecord(resolved, "theme");
for (const [name, theme] of Object.entries(namedThemes)) {
  const color = requiredRecord(theme, "color");
  validateModes(
    {
      light: { ...modes.light, ...requiredRecord(color, "light") },
      dark: { ...modes.dark, ...requiredRecord(color, "dark") },
    },
    name,
  );
}
const variableGroups = themeVariableGroups();
const generated = `// Generated from tokens and licensed design assets. Do not edit.\nexport const tokens = ${JSON.stringify(resolved)} as const;\nexport const fontNotices = ${JSON.stringify(
  {
    harmonyOsSans: {
      attribution: "This product uses HarmonyOS Sans. Copyright 2021 Huawei Device Co., Ltd.",
      license: harmonyLicense,
    },
  },
)} as const;\nexport const themeVariableGroups = ${JSON.stringify(variableGroups)} as const;\n`;
await writeFile(generatedPath, generated, "utf8");

if (!sourceOnly) {
  const distDirectory = resolve(packageRoot, "dist");
  await mkdir(distDirectory, { recursive: true });
  await writeFile(resolve(distDirectory, "tokens.css"), runtimeCss(), "utf8");
  await writeFile(resolve(distDirectory, "theme.css"), themeCss(), "utf8");
}

// Every theme block restates the full geometry surface (own value or the
// base default) so a nested theme scope never inherits an ancestor theme's
// geometry.
function geometryDeclarations(theme) {
  const lines = Object.entries(resolved.radius).map(
    ([name, base]) => `  --lode-radius-${name}: ${theme.radius?.[name] ?? base}px;`,
  );
  lines.push(`  --lode-spacing: ${theme.spacing ?? 4}px;`);
  lines.push(`  --lode-duration-standard: ${theme.motion?.duration?.standard ?? resolved.motion.duration.standard}ms;`);
  lines.push(`  --lode-duration-panel: ${theme.motion?.duration?.panel ?? resolved.motion.duration.panel}ms;`);
  return lines;
}

function runtimeCss() {
  const declarations = (mode) =>
    [
      ...Object.entries(modes[mode]).map(([role, value]) => `  --lode-color-${role}: ${value};`),
      ...Object.entries(shadows[mode]).map(([name, value]) => `  --lode-shadow-${name}: ${value};`),
      `  color-scheme: ${mode};`,
    ].join("\n");
  // The non-color surface a theme (built-in or user CSS) may redefine:
  // radii, the spacing unit every spacing utility multiplies, fonts, motion.
  const baseGeometry = [
    ...Object.entries(resolved.radius).map(([name, value]) => `  --lode-radius-${name}: ${value}px;`),
    "  --lode-spacing: 4px;",
    `  --lode-font-sans: ${cssValue(resolveValue(tokens.get("font.family.interface").value, []), "fontFamily")};`,
    `  --lode-font-mono: ${cssValue(resolveValue(tokens.get("font.family.code").value, []), "fontFamily")};`,
    `  --lode-duration-standard: ${resolved.motion.duration.standard}ms;`,
    `  --lode-duration-panel: ${resolved.motion.duration.panel}ms;`,
    `  --lode-ease-standard: ${cssValue(resolveValue(tokens.get("motion.easing.standard").value, []), "cubicBezier")};`,
    `  --lode-control-hit-target: ${resolved.control.height.comfortable}px;`,
  ].join("\n");
  const themeDeclarations = (theme, mode) =>
    [
      ...Object.entries(requiredRecord(requiredRecord(theme, "color"), mode)).map(
        ([role, value]) => `  --lode-color-${role}: ${value};`,
      ),
      ...geometryDeclarations(theme),
    ].join("\n");
  // Theme blocks are mode-aware so a theme scope composes with any nested
  // data-mode boundary. Descendant matches are wrapped in :where() so an
  // element carrying its own data-theme always beats an ancestor's theme.
  // A user theme stylesheet loads after this file and overrides the same
  // --lode-* variables; that is the entire user-theming contract.
  const themeBlocks = Object.entries(namedThemes).map(
    ([name, theme]) =>
      `[data-theme="${name}"][data-mode="light"],\n[data-mode="light"] [data-theme="${name}"]:not([data-mode]),\n[data-theme="${name}"] :where([data-mode="light"]),\n[data-theme="${name}"]:not([data-mode]) {\n${themeDeclarations(theme, "light")}\n}\n\n[data-theme="${name}"][data-mode="dark"],\n[data-mode="dark"] [data-theme="${name}"]:not([data-mode]),\n[data-theme="${name}"] :where([data-mode="dark"]) {\n${themeDeclarations(theme, "dark")}\n}`,
  );
  const systemDarkThemeBlocks = Object.entries(namedThemes).map(
    ([name, theme]) =>
      `  [data-theme="${name}"]:not([data-mode]) {\n${indent(themeDeclarations(theme, "dark"), 2)}\n  }`,
  );
  // Everything ships inside a cascade layer so an unlayered user stylesheet
  // (the custom-theme contract) beats built-in declarations regardless of the
  // selector specificity the mode/theme scoping needs internally.
  const systemDark = `@media (prefers-color-scheme: dark) {\n  :root:not([data-mode]) {\n${indent(declarations("dark"), 2)}\n  }\n\n${systemDarkThemeBlocks.join("\n\n")}\n}`;
  const body = `:root {\n${baseGeometry}\n}\n\n:root,\n[data-mode="light"] {\n${declarations("light")}\n}\n\n[data-mode="dark"] {\n${declarations("dark")}\n}\n\n${themeBlocks.join("\n\n")}\n\n${systemDark}`;
  return `@layer lode-tokens {\n${body}\n}\n`;
}

function themeVariableGroups() {
  const valuesByTheme = (resolveThemeValue) =>
    Object.fromEntries(
      Object.entries(namedThemes).map(([name, theme]) => [
        name,
        {
          light: resolveThemeValue(theme, "light"),
          dark: resolveThemeValue(theme, "dark"),
        },
      ]),
    );
  const themeMode = (theme, mode) => ({
    ...modes[mode],
    ...requiredRecord(requiredRecord(theme, "color"), mode),
  });
  const themeRadius = (theme, name) => {
    const radius = isRecord(theme.radius) ? theme.radius : {};
    return `${typeof radius[name] === "number" ? radius[name] : resolved.radius[name]}px`;
  };
  const themeSpacing = (theme) => `${typeof theme.spacing === "number" ? theme.spacing : 4}px`;
  const themeDuration = (theme, name) => {
    const motion = isRecord(theme.motion) ? theme.motion : {};
    const duration = isRecord(motion.duration) ? motion.duration : {};
    return `${typeof duration[name] === "number" ? duration[name] : resolved.motion.duration[name]}ms`;
  };
  return [
    {
      id: "color",
      title: "Color",
      variables: Object.keys(modes.light).map((role) => ({
        name: `--lode-color-${role}`,
        kind: "color",
        values: valuesByTheme((theme, mode) => themeMode(theme, mode)[role]),
      })),
    },
    {
      id: "geometry",
      title: "Geometry",
      variables: [
        ...Object.keys(resolved.radius).map((name) => ({
          name: `--lode-radius-${name}`,
          kind: "value",
          values: valuesByTheme((theme) => themeRadius(theme, name)),
        })),
        {
          name: "--lode-spacing",
          kind: "value",
          values: valuesByTheme((theme) => themeSpacing(theme)),
        },
        {
          name: "--lode-control-hit-target",
          kind: "value",
          values: valuesByTheme(() => `${resolved.control.height.comfortable}px`),
        },
      ],
    },
    {
      id: "typography-motion",
      title: "Typography & motion",
      variables: [
        {
          name: "--lode-font-sans",
          kind: "value",
          values: valuesByTheme(() =>
            cssValue(resolveValue(tokens.get("font.family.interface").value, []), "fontFamily"),
          ),
        },
        {
          name: "--lode-font-mono",
          kind: "value",
          values: valuesByTheme(() => cssValue(resolveValue(tokens.get("font.family.code").value, []), "fontFamily")),
        },
        {
          name: "--lode-duration-standard",
          kind: "value",
          values: valuesByTheme((theme) => themeDuration(theme, "standard")),
        },
        {
          name: "--lode-duration-panel",
          kind: "value",
          values: valuesByTheme((theme) => themeDuration(theme, "panel")),
        },
        {
          name: "--lode-ease-standard",
          kind: "value",
          values: valuesByTheme(() =>
            cssValue(resolveValue(tokens.get("motion.easing.standard").value, []), "cubicBezier"),
          ),
        },
      ],
    },
    {
      id: "elevation",
      title: "Elevation",
      variables: Object.keys(shadows.light).map((name) => ({
        name: `--lode-shadow-${name}`,
        kind: "value",
        values: valuesByTheme((_theme, mode) => shadows[mode][name]),
      })),
    },
  ];
}

function indent(value, spaces) {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function themeCss() {
  const lines = [];
  lines.push("  /* Only Lode semantic roles exist; the default palette is removed. */");
  lines.push("  --color-*: initial;");
  for (const role of Object.keys(modes.light)) {
    lines.push(`  --color-${role}: var(--lode-color-${role});`);
  }
  lines.push("");
  lines.push("  --font-*: initial;");
  lines.push("  --font-sans: var(--lode-font-sans);");
  lines.push("  --font-mono: var(--lode-font-mono);");
  lines.push("");
  lines.push("  --text-*: initial;");
  for (const name of Object.keys(resolved.font.size)) {
    lines.push(`  --text-${name}: ${resolved.font.size[name]}px;`);
    const lineHeight = resolved.font["line-height"][name];
    if (lineHeight !== undefined) {
      lines.push(`  --text-${name}--line-height: ${lineHeight}px;`);
    }
  }
  lines.push("");
  lines.push("  --radius-*: initial;");
  for (const name of Object.keys(resolved.radius)) {
    lines.push(`  --radius-${name}: var(--lode-radius-${name});`);
  }
  lines.push("");
  lines.push("  --shadow-*: initial;");
  for (const name of Object.keys(shadows.light)) {
    lines.push(`  --shadow-${name}: var(--lode-shadow-${name});`);
  }
  lines.push("");
  lines.push("  --breakpoint-*: initial;");
  lines.push(`  --breakpoint-md: ${resolved.layout.breakpoint.medium}px;`);
  lines.push(`  --breakpoint-lg: ${resolved.layout.breakpoint.expanded}px;`);
  lines.push(`  --breakpoint-xl: ${resolved.layout.breakpoint.large}px;`);
  lines.push(`  --breakpoint-2xl: ${resolved.layout.breakpoint["extra-large"]}px;`);
  lines.push(`  --container-shell-medium: ${resolved.layout.breakpoint.medium}px;`);
  lines.push(`  --container-shell-expanded: ${resolved.layout.breakpoint.expanded}px;`);
  lines.push("");
  lines.push("  /* The rhythm every spacing utility multiplies; themes may retune it. */");
  lines.push("  --spacing: var(--lode-spacing);");
  lines.push("");
  lines.push("  --ease-*: initial;");
  lines.push("  --ease-standard: var(--lode-ease-standard);");
  lines.push("  --default-transition-duration: var(--lode-duration-standard);");
  lines.push("  --default-transition-timing-function: var(--ease-standard);");
  // `inline` makes utilities reference the underlying --lode-* variables
  // directly, so a nested data-mode or data-theme scope re-resolves them per element.
  return `@theme inline {\n${lines.join("\n")}\n}\n`;
}

function systemModes(value) {
  const color = requiredRecord(value, "color");
  const system = requiredRecord(color, "sys");
  return Object.fromEntries(["light", "dark"].map((mode) => [mode, { ...requiredRecord(system, mode) }]));
}

function validateModes(candidate, themeName = "default") {
  const lightRoles = Object.keys(candidate.light).sort();
  const darkRoles = Object.keys(candidate.dark).sort();
  if (JSON.stringify(lightRoles) !== JSON.stringify(darkRoles)) {
    throw new Error("Light and dark themes must define the same semantic color roles");
  }
  const textPairs = [
    ["foreground", "background"],
    ["foreground", "card"],
    ["card-foreground", "card"],
    ["popover-foreground", "popover"],
    ["muted-foreground", "background"],
    ["muted-foreground", "card"],
    ["muted-foreground", "muted"],
    ["primary-foreground", "primary"],
    ["secondary-foreground", "secondary"],
    ["accent-foreground", "accent"],
    ["destructive-foreground", "destructive"],
    ["destructive-strong", "destructive-subtle"],
    ["success-strong", "success-subtle"],
    ["warning-strong", "warning-subtle"],
  ];
  const componentPairs = [
    ["primary", "background"],
    ["destructive", "background"],
    ["ring", "background"],
  ];
  for (const mode of ["light", "dark"]) {
    const theme = candidate[mode];
    for (const [foreground, background] of textPairs) {
      const ratio = contrastRatio(theme[foreground], theme[background]);
      if (ratio < 4.5) {
        throw new Error(
          `${themeName} accent, ${mode} theme: ${foreground} on ${background} has insufficient contrast ${ratio.toFixed(2)}`,
        );
      }
    }
    for (const [subject, background] of componentPairs) {
      const ratio = contrastRatio(theme[subject], theme[background]);
      if (ratio < 3) {
        throw new Error(
          `${themeName} accent, ${mode} theme: ${subject} on ${background} has insufficient contrast ${ratio.toFixed(2)}`,
        );
      }
    }
  }
}

function contrastRatio(first, second) {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function relativeLuminance(hex) {
  if (typeof hex !== "string" || !/^#[\dA-F]{6}$/iu.test(hex)) {
    throw new Error(`Theme color must be a six-digit hex value: ${String(hex)}`);
  }
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function visit(value, path, inheritedType) {
  if (!isRecord(value)) {
    return;
  }
  const type = typeof value.$type === "string" ? value.$type : inheritedType;
  if (Object.hasOwn(value, "$value")) {
    if (type === undefined) {
      throw new Error(`Design token ${path.join(".")} has no type`);
    }
    tokens.set(path.join("."), { type, value: value.$value });
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!key.startsWith("$")) {
      visit(child, [...path, key], type);
    }
  }
}

function resolveValue(value, stack) {
  if (typeof value === "string") {
    const reference = /^\{([^}]+)\}$/.exec(value)?.[1];
    if (reference === undefined) {
      return value;
    }
    if (stack.includes(reference)) {
      throw new Error(`Circular design token reference: ${[...stack, reference].join(" -> ")}`);
    }
    const token = tokens.get(reference);
    if (token === undefined) {
      throw new Error(`Unknown design token reference: ${reference}`);
    }
    return resolveValue(token.value, [...stack, reference]);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, stack));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveValue(child, stack)]));
  }
  return value;
}

function platformValue(value, type) {
  if (type === "color") {
    return requiredString(value, "hex");
  }
  if (type === "dimension" || type === "duration") {
    return requiredNumber(value, "value");
  }
  return value;
}

function cssValue(value, type) {
  if (type === "fontFamily") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error("fontFamily tokens must contain strings");
    }
    return value.map((family) => (family.includes(" ") ? `"${family}"` : family)).join(", ");
  }
  if (type === "cubicBezier") {
    if (!Array.isArray(value)) {
      throw new Error("cubicBezier tokens must contain an array");
    }
    return `cubic-bezier(${value.join(", ")})`;
  }
  return String(value);
}

function setPath(target, path, value) {
  const [head, ...tail] = path;
  if (head === undefined) {
    return;
  }
  if (tail.length === 0) {
    target[head] = value;
    return;
  }
  const child = isRecord(target[head]) ? target[head] : {};
  target[head] = child;
  setPath(child, tail, value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value, key) {
  if (!isRecord(value) || typeof value[key] !== "string") {
    throw new Error(`Design token value is missing string ${key}`);
  }
  return value[key];
}

function requiredRecord(value, key) {
  if (!isRecord(value[key])) {
    throw new Error(`Design token document is missing object ${key}`);
  }
  return value[key];
}

function requiredNumber(value, key) {
  if (!isRecord(value) || typeof value[key] !== "number") {
    throw new Error(`Design token value is missing number ${key}`);
  }
  return value[key];
}
