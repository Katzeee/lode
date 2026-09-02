import { useState } from "react";

import { Alert } from "../ui/alert.js";
import { Badge, BadgeDot } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Field, FieldLabel } from "../ui/field.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";
import { applyUserTheme, clearUserTheme, themeNames, type ThemeName } from "./catalog-theme.js";
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
      <CustomThemeSpecimen />
    </>
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
