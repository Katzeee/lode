import { Badge, BadgeDot } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Field, FieldLabel } from "../ui/field.js";
import { Input } from "../ui/input.js";
import { accentNames, type AccentName } from "./catalog-theme.js";
import { PageIntro, Specimen } from "./specimen.js";

const roles = ["primary", "primary-foreground", "accent", "accent-foreground", "ring"] as const;

export function ThemingPage({
  accent,
  onAccentChange,
}: Readonly<{ accent: AccentName; onAccentChange(accent: AccentName): void }>) {
  return (
    <>
      <PageIntro
        description="Color has two independent axes. The mode axis (light, dark) resolves the neutral world; the accent axis re-tints every action role. Components speak the same semantic vocabulary either way, so a theme is a choice, never a rewrite."
        title="Theming"
      />
      <Specimen
        className="gap-2.5"
        description="The accent applies to this whole catalog — switch it, then browse any page. Every primary action, focus ring, and accent surface follows."
        title="Accent"
      >
        {accentNames.map((name) => (
          <Button
            aria-pressed={accent === name}
            key={name}
            onClick={() => onAccentChange(name)}
            size="sm"
            variant={accent === name ? "primary" : "outline"}
          >
            {name.charAt(0).toUpperCase() + name.slice(1)}
          </Button>
        ))}
      </Specimen>
      <Specimen
        className="grid grid-cols-1 items-stretch gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3"
        description="Every accent carries both mode resolutions and passes the same contrast gates. Nothing inside these frames knows which theme it lives in."
        title="Accent × mode"
      >
        {accentNames.map((name) => (
          <div className="flex flex-col gap-3" key={name}>
            <ThemeFrame accent={name} theme="light" />
            <ThemeFrame accent={name} theme="dark" />
          </div>
        ))}
      </Specimen>
      <Specimen
        className="flex-col flex-nowrap items-stretch gap-2"
        description="An accent is a contract: it supplies exactly these role resolutions, and the generator rejects any accent that fails a contrast gate."
        title="Accent contract"
      >
        <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,1fr)] gap-3 pb-1 text-caption font-semibold tracking-widest text-muted-foreground uppercase">
          <span>Role</span>
          {accentNames.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
        {roles.map((role) => (
          <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,1fr)] items-center gap-3" key={role}>
            <span className="truncate font-mono text-caption text-muted-foreground">{role}</span>
            {accentNames.map((name) => (
              <span className="flex gap-1" key={name}>
                <RoleSwatch accent={name} role={role} theme="light" />
                <RoleSwatch accent={name} role={role} theme="dark" />
              </span>
            ))}
          </div>
        ))}
      </Specimen>
    </>
  );
}

function ThemeFrame({ accent, theme }: Readonly<{ accent: AccentName; theme: "light" | "dark" }>) {
  return (
    <div
      className="min-w-0 flex-1 rounded-xl border border-border bg-background p-4"
      data-accent={accent}
      data-theme={theme}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-caption font-semibold tracking-widest text-muted-foreground uppercase">
          {accent} · {theme}
        </p>
        <Badge tone="accent">
          <BadgeDot />
          Accent
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

function RoleSwatch({ accent, role, theme }: Readonly<{ accent: AccentName; role: string; theme: "light" | "dark" }>) {
  return (
    <span
      className="flex-1 rounded-sm border border-border bg-background p-0.5"
      data-accent={accent}
      data-theme={theme}
    >
      <span className="block h-6 rounded-xs border border-border" style={{ background: `var(--lode-color-${role})` }} />
    </span>
  );
}
