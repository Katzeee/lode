import { Fragment } from "react";

import { Icon } from "./icon.js";

export type BreadcrumbItem = Readonly<{
  href?: string;
  label: string;
  onSelect?: () => void;
}>;

export function Breadcrumbs({ items }: Readonly<{ items: readonly BreadcrumbItem[] }>) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-0.5 text-label">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${String(index)}`}>
              {index === 0 ? null : (
                <li aria-hidden className="text-muted-foreground/60">
                  <Icon className="size-3.5" name="chevron-right" />
                </li>
              )}
              <li className="min-w-0">
                <BreadcrumbEntry current={current} item={item} />
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

const linkClassName =
  "block max-w-full truncate rounded-sm px-1.5 py-1 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/45";

function BreadcrumbEntry({ current, item }: Readonly<{ current: boolean; item: BreadcrumbItem }>) {
  if (!current && item.href !== undefined) {
    return (
      <a className={linkClassName} href={item.href}>
        {item.label}
      </a>
    );
  }
  if (!current && item.onSelect !== undefined) {
    return (
      <button className={linkClassName} onClick={item.onSelect} type="button">
        {item.label}
      </button>
    );
  }
  return (
    <span
      aria-current={current ? "page" : undefined}
      className="block truncate rounded-sm px-1.5 py-1 font-medium text-foreground"
    >
      {item.label}
    </span>
  );
}
