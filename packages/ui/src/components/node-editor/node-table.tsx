import type { ReactNode } from "react";

export type NodeTableColumn = Readonly<{ key: string; heading: ReactNode }>;
export type NodeTableRow = Readonly<{ key: string; cells: ReadonlyMap<string, ReactNode> }>;

/** The table owns geometry; each cell hosts an independently addressable node editing region. */
export function NodeTable({
  label,
  columns,
  rows,
  footer,
}: Readonly<{
  label: string;
  columns: readonly NodeTableColumn[];
  rows: readonly NodeTableRow[];
  footer?: ReactNode;
}>) {
  return (
    <div className="max-w-full overflow-x-auto" data-ui="node-table">
      <table aria-label={label} className="w-full border-collapse text-left text-document-body">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="min-w-48 border-b border-border px-2 py-2 font-normal text-muted-foreground first:min-w-64"
              >
                {column.heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {columns.map((column) => (
                <td key={column.key} className="border-b border-r border-border/50 px-1 py-1 align-top last:border-r-0">
                  {row.cells.get(column.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
    </div>
  );
}
