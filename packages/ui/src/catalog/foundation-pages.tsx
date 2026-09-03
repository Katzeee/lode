import { tokens } from "@lode/design-tokens";

import { PageIntro, Specimen } from "./specimen.js";

const colorGroups = [
  { title: "Canvas & surfaces", roles: ["background", "card", "popover", "muted", "accent"] },
  { title: "Text", roles: ["foreground", "muted-foreground", "accent-foreground"] },
  { title: "Action", roles: ["primary", "primary-foreground", "secondary", "ring"] },
  {
    title: "Feedback",
    roles: ["success", "success-subtle", "warning", "warning-subtle", "destructive", "destructive-subtle"],
  },
  { title: "Lines", roles: ["border", "input"] },
] as const;

export function ColorPage() {
  return (
    <>
      <PageIntro
        description="Semantic roles are the only color API. Toggle the catalog theme to watch every swatch resolve its other value."
        title="Color"
      />
      {colorGroups.map((group) => (
        <Specimen className="gap-3" key={group.title} title={group.title}>
          {group.roles.map((role) => (
            <ColorSwatch key={role} role={role} />
          ))}
        </Specimen>
      ))}
    </>
  );
}

function ColorSwatch({ role }: Readonly<{ role: string }>) {
  return (
    <div className="flex w-40 flex-col flex-nowrap gap-2">
      <span
        className="h-16 rounded-md border border-border shadow-xs"
        style={{ background: `var(--lode-color-${role})` }}
      />
      <span className="font-mono text-caption text-muted-foreground">{role}</span>
    </div>
  );
}

// Explicit classes keep every scale utility statically visible to Tailwind.
const typeScale = [
  ["caption", "text-caption"],
  ["label", "text-label"],
  ["body", "text-body"],
  ["body-large", "text-body-large"],
  ["title-small", "text-title-small"],
  ["title", "text-title"],
  ["page-title", "text-page-title"],
  ["display", "text-display"],
] as const;

export function TypographyPage() {
  return (
    <>
      <PageIntro
        description="HarmonyOS Sans SC carries both interface and document text; JetBrains Mono carries identities and code."
        title="Typography"
      />
      <Specimen className="flex-col flex-nowrap items-stretch gap-5" title="Type scale">
        {typeScale.map(([name, className]) => (
          <div className="flex items-baseline gap-6" key={name}>
            <span className="w-32 shrink-0 font-mono text-caption text-muted-foreground">
              {name} · {tokens.font.size[name]}px
            </span>
            <span className={`${className} min-w-0 truncate`}>知识长存 Local knowledge, one authority</span>
          </div>
        ))}
      </Specimen>
      <Specimen className="flex-col flex-nowrap items-stretch" title="Multilingual rendering">
        <p className="text-body-large">
          Lode 将你的知识保存在本地 — every fact, decision, and revision stays on hardware you own.
        </p>
        <p className="font-mono text-body text-muted-foreground">workspace_9f3a…c21b · JetBrains Mono fallback</p>
      </Specimen>
    </>
  );
}

const radii = Object.entries(tokens.radius) as readonly [string, number][];
const spaceSteps = Object.entries(tokens.space) as readonly [string, number][];

const { breakpoint, grid, gutter } = tokens.layout;
const windowClasses = [
  { id: "compact", range: `0–${breakpoint.medium - 1}px`, columns: grid.compact, gutter: gutter.compact },
  {
    id: "medium",
    range: `${breakpoint.medium}–${breakpoint.expanded - 1}px`,
    columns: grid.medium,
    gutter: gutter.regular,
  },
  {
    id: "expanded",
    range: `${breakpoint.expanded}–${breakpoint.large - 1}px`,
    columns: grid.expanded,
    gutter: gutter.regular,
  },
  {
    id: "large",
    range: `${breakpoint.large}–${breakpoint["extra-large"] - 1}px`,
    columns: grid.expanded,
    gutter: gutter.expanded,
  },
  { id: "extra-large", range: `≥ ${breakpoint["extra-large"]}px`, columns: grid.expanded, gutter: gutter.expanded },
] as const;

export function GeometryPage() {
  return (
    <>
      <PageIntro
        description="A 4px rhythm, six radii, four elevation steps, and motion that stays under 200ms."
        title="Geometry & motion"
      />
      <Specimen
        className="flex-col flex-nowrap items-stretch gap-0 divide-y divide-border"
        description="Every Lode surface — desktop window, preview frame, or phone — resolves the same classes from its own width. Components adapt with container queries, not device detection."
        title="Window classes"
      >
        <div className="hidden grid-cols-[1fr_1.2fr_0.8fr_0.8fr] gap-3 pb-2 text-caption font-semibold tracking-widest text-muted-foreground uppercase @xl:grid">
          <span>Class</span>
          <span>Window width</span>
          <span>Columns</span>
          <span>Gutter</span>
        </div>
        {windowClasses.map((windowClass) => (
          <div
            className="grid grid-cols-2 gap-3 py-2.5 text-body @xl:grid-cols-[1fr_1.2fr_0.8fr_0.8fr]"
            key={windowClass.id}
          >
            <span className="font-medium">{windowClass.id}</span>
            <span className="break-all font-mono text-label text-muted-foreground">{windowClass.range}</span>
            <span className="text-muted-foreground">{windowClass.columns} columns</span>
            <span className="text-muted-foreground">{windowClass.gutter}px gutter</span>
          </div>
        ))}
      </Specimen>
      <Specimen
        className="items-end gap-3"
        title="Spacing rhythm"
        description="Every spacing utility multiplies one rhythm variable; a denser theme retunes the whole page at once."
      >
        {spaceSteps.map(([name, value]) => (
          <div className="flex flex-col flex-nowrap items-center gap-2" key={name}>
            <span
              className="w-6 rounded-xs bg-primary/70"
              style={{ height: `calc(var(--lode-spacing) * ${value / 4})` }}
            />
            <span className="font-mono text-caption text-muted-foreground">{name}</span>
          </div>
        ))}
      </Specimen>
      <Specimen
        className="gap-5"
        description="Samples resolve the live radius variables, so themes reshape them."
        title="Radii"
      >
        {radii.map(([name, value]) => (
          <div className="flex flex-col flex-nowrap items-center gap-2" key={name}>
            <span
              className="size-16 border border-border bg-accent"
              style={{ borderRadius: `min(var(--lode-radius-${name}), 32px)` }}
            />
            <span className="font-mono text-caption text-muted-foreground">
              {name} · {value}px
            </span>
          </div>
        ))}
      </Specimen>
      <Specimen
        className="gap-5"
        title="Elevation"
        description="Shadows are theme-resolved; dark surfaces rely more on borders."
      >
        {["xs", "sm", "md", "lg"].map((step) => (
          <div className="flex flex-col flex-nowrap items-center gap-2" key={step}>
            <span className="size-20 rounded-md bg-card" style={{ boxShadow: `var(--lode-shadow-${step})` }} />
            <span className="font-mono text-caption text-muted-foreground">shadow-{step}</span>
          </div>
        ))}
      </Specimen>
      <Specimen className="flex-col flex-nowrap items-stretch gap-2" title="Motion">
        {Object.entries(tokens.motion.duration).map(([name, value]) => (
          <p className="text-body text-muted-foreground" key={name}>
            <span className="inline-block w-24 font-mono text-caption">{name}</span>
            {value}ms · cubic-bezier(0.2, 0, 0, 1)
          </p>
        ))}
      </Specimen>
    </>
  );
}
