import { themeVariableGroups } from "@lode/design-tokens";
import { useEffect, useState } from "react";

import { Alert } from "../ui/alert.js";
import { Badge, BadgeDot } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Field, FieldLabel } from "../ui/field.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";
import {
  applyUserTheme,
  clearUserTheme,
  observeThemeVariableChanges,
  themeNames,
  type ThemeName,
  useCatalogMode,
} from "./catalog-theme.js";
import { PageIntro, Specimen } from "./specimen.js";

export function ThemingPage({
  onThemeChange,
  theme,
}: Readonly<{ onThemeChange(theme: ThemeName): void; theme: ThemeName }>) {
  return (
    <>
      <PageIntro
        description="Color has two independent axes. The mode axis (light, dark) is a system preference; the theme axis is a complete resolution of every semantic color role. Components speak the vocabulary and never a literal value, so switching a theme re-skins every surface — this catalog included — without touching layout, spacing, or type."
        title="Theming"
      />
      <Specimen
        className="gap-2.5"
        description="Themes ship with the product and work on every platform. Switch one, then browse any page — the whole catalog renders under it."
        title="Built-in themes"
      >
        {themeNames.map((name) => (
          <Button
            aria-pressed={theme === name}
            key={name}
            onClick={() => onThemeChange(name)}
            size="sm"
            variant={theme === name ? "primary" : "outline"}
          >
            {name.charAt(0).toUpperCase() + name.slice(1)}
          </Button>
        ))}
      </Specimen>
      <Specimen
        className="grid grid-cols-1 items-stretch gap-4 @3xl:grid-cols-2"
        description="Each theme resolves both modes and passes the same contrast gates in CI. Nothing inside these frames knows which theme it lives in."
        title="Theme × mode"
      >
        {themeNames.map((name) => (
          <div className="flex flex-col gap-3" key={name}>
            <ThemeFrame mode="light" theme={name} />
            <ThemeFrame mode="dark" theme={name} />
          </div>
        ))}
      </Specimen>
      <ThemeVariablesSpecimen theme={theme} />
      <CustomThemeSpecimen />
    </>
  );
}

function ThemeVariablesSpecimen({ theme }: Readonly<{ theme: ThemeName }>) {
  const mode = useCatalogMode();
  const [values, setValues] = useState<Record<string, string>>(() => fallbackVariableValues(theme, mode));

  useEffect(() => {
    const update = () => {
      const computed = getComputedStyle(document.documentElement);
      setValues(
        Object.fromEntries(
          themeVariableGroups.flatMap(({ variables }) =>
            variables.map(({ name }) => [name, computed.getPropertyValue(name).trim()]),
          ),
        ),
      );
    };
    const frame = window.requestAnimationFrame(update);
    const stopObserving = observeThemeVariableChanges(update);
    return () => {
      window.cancelAnimationFrame(frame);
      stopObserving();
    };
  }, [mode, theme]);

  return (
    <Specimen
      className="flex-col flex-nowrap items-stretch gap-6"
      description="This generated list is the complete custom-theme API. Values are read from the catalog root, so they reflect the active theme, mode, and custom CSS."
      title="Variables"
    >
      {themeVariableGroups.map((group) => (
        <div className="flex flex-col gap-2" key={group.id}>
          <h3 className="text-label font-semibold">{group.title}</h3>
          <div className="overflow-hidden rounded-md border border-border">
            {group.variables.map((variable) => {
              const value = values[variable.name] ?? variable.values[theme][mode];
              return (
                <div
                  className="grid grid-cols-1 gap-1 border-b border-border px-3 py-2 last:border-b-0 @xl:grid-cols-2 @xl:items-center"
                  key={variable.name}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {variable.kind === "color" ? (
                      <span
                        aria-hidden
                        className="size-6 shrink-0 rounded-xs border border-border"
                        style={{ backgroundColor: value }}
                      />
                    ) : null}
                    <code className="min-w-0 break-all font-mono text-caption text-foreground">{variable.name}</code>
                  </div>
                  <code className="break-all font-mono text-caption text-muted-foreground">{value}</code>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Specimen>
  );
}

function fallbackVariableValues(theme: ThemeName, mode: "light" | "dark"): Record<string, string> {
  return Object.fromEntries(
    themeVariableGroups.flatMap(({ variables }) =>
      variables.map((variable) => [variable.name, variable.values[theme][mode]]),
    ),
  );
}

function ThemeFrame({ mode, theme }: Readonly<{ mode: "light" | "dark"; theme: ThemeName }>) {
  return (
    <div
      className="min-w-0 flex-1 rounded-xl border border-border bg-background p-4"
      data-mode={mode}
      data-theme={theme}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-caption font-semibold tracking-widest text-muted-foreground uppercase">
          {theme} · {mode}
        </p>
        <Badge tone="success">
          <BadgeDot />
          Ready
        </Badge>
      </div>
      <Field>
        <FieldLabel>Vault passphrase</FieldLabel>
        <Input placeholder="At least 8 characters" type="password" />
      </Field>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm">Unlock</Button>
        <Button size="sm" variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// The example teaches users to write literal colors — that is exactly the
// custom-theme contract, so the token-discipline rule is deliberately waived.
/* eslint-disable design/no-raw-visual-values */
const customThemePlaceholder = `/* Override any --lode-* variable; scope dark values with [data-mode="dark"]. */
:root {
  --lode-color-background: #FBF7EF;
  --lode-color-primary: #7C4A1E;
  --lode-radius-md: 2px;
  --lode-spacing: 5px;
}
[data-mode="dark"] {
  --lode-color-background: #191512;
  --lode-color-primary: #E8B583;
}`;
/* eslint-enable design/no-raw-visual-values */

function CustomThemeSpecimen() {
  const [css, setCss] = useState("");
  const [active, setActive] = useState(false);
  return (
    <Specimen
      className="flex-col flex-nowrap items-stretch gap-3"
      description="Desktop accepts any CSS as a user theme, loaded after the token stylesheet. Overriding the documented --lode-color-* variables is the whole contract; the built-in contrast guarantees do not apply to what you write here."
      title="Custom theme (CSS)"
    >
      <Textarea
        aria-label="Custom theme CSS"
        className="min-h-40 font-mono text-caption/relaxed"
        onChange={(event) => setCss(event.target.value)}
        placeholder={customThemePlaceholder}
        rows={8}
        spellCheck={false}
        value={css}
      />
      <div className="flex items-center gap-2">
        <Button
          onClick={() => {
            applyUserTheme(css);
            setActive(true);
          }}
          size="sm"
        >
          Apply custom theme
        </Button>
        <Button
          disabled={!active}
          onClick={() => {
            clearUserTheme();
            setActive(false);
          }}
          size="sm"
          variant="outline"
        >
          Remove
        </Button>
      </div>
      {active ? (
        <Alert tone="warning">
          A custom theme is active. It stays applied while this window is open, across the catalog and the product
          shell.
        </Alert>
      ) : null}
    </Specimen>
  );
}
