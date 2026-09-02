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

const themes = systemThemes(resolved);
const accents = requiredRecord(requiredRecord(resolved, "color"), "accent");
for (const [name, accent] of Object.entries(accents)) {
  validateThemes({
    light: { ...themes.light, ...requiredRecord(accent, "light") },
    dark: { ...themes.dark, ...requiredRecord(accent, "dark") },
  }, name);
}
const generated = `// Generated from tokens and licensed design assets. Do not edit.\nexport const tokens = ${JSON.stringify(resolved)} as const;\nexport const fontNotices = ${JSON.stringify(
  {
    harmonyOsSans: {
      attribution: "This product uses HarmonyOS Sans. Copyright 2021 Huawei Device Co., Ltd.",
      license: harmonyLicense,
    },
  },
)} as const;\n`;
await writeFile(generatedPath, generated, "utf8");

if (!sourceOnly) {
  const distDirectory = resolve(packageRoot, "dist");
  await mkdir(distDirectory, { recursive: true });
  await writeFile(resolve(distDirectory, "tokens.css"), runtimeCss(), "utf8");
  await writeFile(resolve(distDirectory, "theme.css"), themeCss(), "utf8");
}

function runtimeCss() {
  const declarations = (mode) =>
    [
      ...Object.entries(themes[mode]).map(([role, value]) => `  --lode-color-${role}: ${value};`),
      ...Object.entries(shadows[mode]).map(([name, value]) => `  --lode-shadow-${name}: ${value};`),
      `  color-scheme: ${mode};`,
    ].join("\n");
  const accentDeclarations = (roles) =>
    Object.entries(roles)
      .map(([role, value]) => `  --lode-color-${role}: ${value};`)
      .join("\n");
  // Accent blocks are mode-aware so an accent scope composes with any nested
  // data-theme boundary. Descendant matches are wrapped in :where() so an
  // element carrying its own data-accent always beats an ancestor's accent.
  const accentBlocks = Object.entries(accents).map(
    ([name, accent]) =>
      `[data-accent="${name}"]:not([data-theme="dark"]),\n[data-accent="${name}"] :where([data-theme="light"]) {\n${accentDeclarations(accent.light)}\n}\n\n[data-accent="${name}"][data-theme="dark"],\n[data-accent="${name}"] :where([data-theme="dark"]) {\n${accentDeclarations(accent.dark)}\n}`,
  );
  return `:root,\n[data-theme="light"] {\n${declarations("light")}\n}\n\n[data-theme="dark"] {\n${declarations("dark")}\n}\n\n${accentBlocks.join("\n\n")}\n`;
}

function themeCss() {
  const lines = [];
  lines.push("  /* Only Lode semantic roles exist; the default palette is removed. */");
  lines.push("  --color-*: initial;");
  for (const role of Object.keys(themes.light)) {
    lines.push(`  --color-${role}: var(--lode-color-${role});`);
  }
  lines.push("");
  lines.push("  --font-*: initial;");
  lines.push(`  --font-sans: ${cssValue(resolveValue(tokens.get("font.family.interface").value, []), "fontFamily")};`);
  lines.push(`  --font-mono: ${cssValue(resolveValue(tokens.get("font.family.code").value, []), "fontFamily")};`);
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
  for (const [name, value] of Object.entries(resolved.radius)) {
    lines.push(`  --radius-${name}: ${value}px;`);
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
  lines.push("");
  lines.push("  /* The 4px rhythm every spacing utility resolves against. */");
  lines.push("  --spacing: 4px;");
  lines.push("");
  lines.push("  --ease-*: initial;");
  lines.push(`  --ease-standard: ${cssValue(resolveValue(tokens.get("motion.easing.standard").value, []), "cubicBezier")};`);
  lines.push(`  --default-transition-duration: ${resolved.motion.duration.standard}ms;`);
  lines.push("  --default-transition-timing-function: var(--ease-standard);");
  // `inline` makes utilities reference the underlying --lode-* variables
  // directly, so a nested data-theme scope re-resolves them per element.
  return `@theme inline {\n${lines.join("\n")}\n}\n`;
}

function systemThemes(value) {
  const color = requiredRecord(value, "color");
  const system = requiredRecord(color, "sys");
  return Object.fromEntries(
    ["light", "dark"].map((mode) => [mode, { ...requiredRecord(system, mode) }]),
  );
}

function validateThemes(candidate, accentName = "default") {
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
          `${accentName} accent, ${mode} theme: ${foreground} on ${background} has insufficient contrast ${ratio.toFixed(2)}`,
        );
      }
    }
    for (const [subject, background] of componentPairs) {
      const ratio = contrastRatio(theme[subject], theme[background]);
      if (ratio < 3) {
        throw new Error(
          `${accentName} accent, ${mode} theme: ${subject} on ${background} has insufficient contrast ${ratio.toFixed(2)}`,
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
