import type { ReactNode } from "react";

import { PageIntro } from "./specimen.js";

export function ProductPreviewPage({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <PageIntro
        description="The real product shell, driven by an in-memory Engine stand-in. Initialize a Home to walk the actual flow."
        title="Product preview"
      />
      <div className="overflow-hidden rounded-xl border border-border bg-background shadow-md">{children}</div>
    </>
  );
}
