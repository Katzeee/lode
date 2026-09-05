import { Badge, outlineFormatting, type OutlineInlineExtension } from "@lode/ui";
import { referenceData } from "./node-source.js";
export function workspaceExtensions(navigate: (nodeId: string) => void): readonly OutlineInlineExtension[] {
  return [
    ...outlineFormatting,
    {
      id: "reference",
      render: ({ children, token }) => {
        const data = token && referenceData(token);
        return (
          <a
            className="text-primary underline decoration-primary/45 underline-offset-2"
            data-ui="outline-reference"
            href={data ? `#node-${data.targetNodeId}` : undefined}
            onClick={(event) => {
              event.preventDefault();
              if (data) {
                navigate(data.targetNodeId);
              }
            }}
          >
            {children}
          </a>
        );
      },
    },
    {
      id: "supertag",
      render: ({ children }) => (
        <Badge size="inline" tone="accent">
          {children}
        </Badge>
      ),
    },
  ];
}
