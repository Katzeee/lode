import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js";
import { PageIntro, Specimen } from "./specimen.js";

const principles = [
  {
    title: "One token source",
    detail:
      "Every color, size, radius, and duration resolves from the design-tokens package. Components and screens never carry raw values.",
  },
  {
    title: "One component layer",
    detail:
      "Product screens render exclusively through the ui components. A visual change lands in one file and reaches every surface.",
  },
  {
    title: "Modes, themes, one vocabulary",
    detail:
      "Light and dark modes, built-in themes, and user CSS all resolve the same semantic roles. A region scoped with data-mode or data-theme switches wholesale — no per-component theming.",
  },
] as const;

export function OverviewPage() {
  return (
    <>
      <PageIntro
        description="The interface system behind every Lode surface: paper-calm in the light, forest-deep in the dark, HarmonyOS Sans throughout."
        title="Lode Design System"
      />
      <div className="mb-10 grid gap-4 lg:grid-cols-3">
        {principles.map((principle) => (
          <Card key={principle.title}>
            <CardHeader>
              <CardTitle className="text-body-large">{principle.title}</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <CardDescription>{principle.detail}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
      <Specimen description="A quick taste of the working component layer." title="At a glance">
        <Button>Primary action</Button>
        <Button variant="outline">Outline</Button>
        <Badge tone="success">Ready</Badge>
        <Badge tone="accent">Local-first</Badge>
      </Specimen>
    </>
  );
}
