export const buttonVariants = ["primary", "secondary", "outline", "ghost", "destructive"] as const;
export type ButtonVariant = (typeof buttonVariants)[number];

export const buttonSizes = ["sm", "md", "lg"] as const;
export type ButtonSize = (typeof buttonSizes)[number];

export const badgeTones = ["neutral", "accent", "success", "warning", "destructive"] as const;
export type BadgeTone = (typeof badgeTones)[number];

export const alertTones = ["neutral", "success", "warning", "destructive"] as const;
export type AlertTone = (typeof alertTones)[number];

export type CatalogPageId =
  | "overview"
  | "color"
  | "theming"
  | "typography"
  | "geometry"
  | "buttons"
  | "forms"
  | "status"
  | "surfaces"
  | "product";

export type CatalogPage = Readonly<{
  description: string;
  id: CatalogPageId;
  path: string;
  title: string;
}>;

export type CatalogSectionId = "foundations" | "components" | "templates";

export type CatalogSection = Readonly<{
  id: CatalogSectionId;
  pages: readonly CatalogPage[];
  title: string;
}>;

const page = (id: CatalogPageId, path: string, title: string, description: string): CatalogPage => ({
  description,
  id,
  path,
  title,
});

export const overviewPage = page(
  "overview",
  "",
  "Overview",
  "One token source, one component layer, and the rules that keep every Lode surface consistent.",
);

export const catalogSections: readonly CatalogSection[] = [
  {
    id: "foundations",
    title: "Foundations",
    pages: [
      page(
        "color",
        "foundations/color",
        "Color",
        "Semantic roles resolved per theme; components never touch raw values.",
      ),
      page(
        "theming",
        "foundations/theming",
        "Theming",
        "One semantic vocabulary, two resolutions; any region flips wholesale.",
      ),
      page("typography", "foundations/typography", "Typography", "HarmonyOS Sans SC and the eight-step type scale."),
      page(
        "geometry",
        "foundations/geometry",
        "Geometry & motion",
        "Spacing rhythm, radii, elevation, and motion timing.",
      ),
    ],
  },
  {
    id: "components",
    title: "Components",
    pages: [
      page("buttons", "components/buttons", "Buttons", "Action hierarchy, sizes, and busy states."),
      page("forms", "components/forms", "Forms", "Fields, inputs, validation, and switches."),
      page("status", "components/status", "Status", "Badges, alerts, and progress indication."),
      page("surfaces", "components/surfaces", "Surfaces", "Cards and the panels that structure a page."),
    ],
  },
  {
    id: "templates",
    title: "Templates",
    pages: [
      page(
        "product",
        "templates/product",
        "Product preview",
        "The live product shell rendered from system components.",
      ),
    ],
  },
];

export const catalogPages: readonly CatalogPage[] = [overviewPage, ...catalogSections.flatMap(({ pages }) => pages)];

export function findCatalogPage(path: string): CatalogPage | undefined {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  return catalogPages.find((candidate) => candidate.path === normalized);
}
