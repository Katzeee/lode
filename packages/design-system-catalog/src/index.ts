export const buttonVariants = ["primary", "secondary", "outline", "ghost", "destructive"] as const;
export type ButtonVariant = (typeof buttonVariants)[number];

export const buttonSizes = ["sm", "md", "lg"] as const;
export type ButtonSize = (typeof buttonSizes)[number];

export const badgeTones = ["neutral", "accent", "success", "warning", "destructive"] as const;
export type BadgeTone = (typeof badgeTones)[number];

export const alertTones = ["neutral", "success", "warning", "destructive"] as const;
export type AlertTone = (typeof alertTones)[number];

export const iconNames = [
  "app-window",
  "check",
  "chevron-down",
  "circle-alert",
  "copy",
  "ellipsis",
  "house",
  "layers",
  "layout-template",
  "messages-square",
  "moon",
  "mouse-pointer-click",
  "palette",
  "pencil",
  "shapes",
  "sun",
  "sun-moon",
  "text-cursor-input",
  "trash",
  "type",
  "x",
] as const;
export type IconName = (typeof iconNames)[number];

export type CatalogPageId =
  | "overview"
  | "color"
  | "theming"
  | "typography"
  | "content"
  | "geometry"
  | "buttons"
  | "forms"
  | "overlays"
  | "status"
  | "surfaces"
  | "layouts"
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
      page("content", "foundations/content", "Content", "Sentence patterns and naming rules for clear interface copy."),
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
      page("overlays", "components/overlays", "Overlays", "Dialogs, menus, tooltips, and transient notifications."),
      page("status", "components/status", "Status", "Badges, alerts, and progress indication."),
      page("surfaces", "components/surfaces", "Surfaces", "Cards and the panels that structure a page."),
    ],
  },
  {
    id: "templates",
    title: "Templates",
    pages: [
      page(
        "layouts",
        "templates/layouts",
        "Responsive layouts",
        "App shell, page scaffold, and the list-detail navigation pattern.",
      ),
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

export const catalogPageIcons: Readonly<Record<CatalogPageId, IconName>> = {
  overview: "house",
  color: "palette",
  theming: "sun-moon",
  typography: "type",
  content: "messages-square",
  geometry: "shapes",
  buttons: "mouse-pointer-click",
  forms: "text-cursor-input",
  overlays: "ellipsis",
  status: "circle-alert",
  surfaces: "layers",
  layouts: "layout-template",
  product: "app-window",
};

export function findCatalogPage(path: string): CatalogPage | undefined {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  return catalogPages.find((candidate) => candidate.path === normalized);
}
