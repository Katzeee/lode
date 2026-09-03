import type { ReactNode } from "react";

import { Button } from "./button.js";

export function ListDetail({
  detail,
  detailVisible,
  list,
  onBack,
}: Readonly<{
  detail: ReactNode;
  detailVisible: boolean;
  list: ReactNode;
  onBack: () => void;
}>) {
  return (
    <div
      className="@container/list-detail overflow-hidden rounded-lg border border-border bg-card"
      data-ui="list-detail"
    >
      <div className="@shell-expanded/list-detail:grid @shell-expanded/list-detail:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1.28fr)]">
        <section
          aria-label="Items"
          className={`${detailVisible ? "hidden" : "block"} min-w-0 @shell-expanded/list-detail:block @shell-expanded/list-detail:border-r @shell-expanded/list-detail:border-border`}
          data-pane="list"
        >
          {list}
        </section>
        <section
          aria-label="Details"
          className={`${detailVisible ? "block" : "hidden"} min-w-0 @shell-expanded/list-detail:block`}
          data-pane="detail"
        >
          <div className="border-b border-border p-3 @shell-expanded/list-detail:hidden">
            <Button onClick={onBack} size="sm" variant="ghost">
              ← Back to list
            </Button>
          </div>
          {detail}
        </section>
      </div>
    </div>
  );
}
