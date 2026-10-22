import { Breadcrumbs } from "../components/breadcrumbs.js";
import { Tab, TabPanel, Tabs, TabsList } from "../components/tabs.js";
import { PageIntro, Specimen } from "./specimen.js";

export function NavigationPage() {
  return (
    <>
      <PageIntro
        description="Navigation states carry text labels and live in the URL where possible, so views stay addressable and restorable."
        title="Navigation"
      />
      <Specimen
        className="flex-col flex-nowrap items-stretch"
        description="Tabs segment one subject into peer views; the selected tab is part of the surface state."
        title="Tabs"
      >
        <Tabs defaultValue="content">
          <TabsList aria-label="Node views">
            <Tab value="content">Content</Tab>
            <Tab value="references">References</Tab>
            <Tab value="history">History</Tab>
          </TabsList>
          <TabPanel className="text-body text-muted-foreground" value="content">
            The node itself: its fields, children, and inline content.
          </TabPanel>
          <TabPanel className="text-body text-muted-foreground" value="references">
            Every node that links here, grouped by Workspace.
          </TabPanel>
          <TabPanel className="text-body text-muted-foreground" value="history">
            Fact-by-fact history of this node, newest first.
          </TabPanel>
        </Tabs>
      </Specimen>
      <Specimen
        description="Breadcrumbs expose the node path; every ancestor is one tap from anywhere in the hierarchy."
        title="Breadcrumbs"
      >
        <Breadcrumbs
          items={[
            { href: "#/design-system/components/navigation", label: "Personal knowledge" },
            { href: "#/design-system/components/navigation", label: "Projects" },
            { href: "#/design-system/components/navigation", label: "Lode" },
            { label: "Design system roadmap" },
          ]}
        />
      </Specimen>
    </>
  );
}
