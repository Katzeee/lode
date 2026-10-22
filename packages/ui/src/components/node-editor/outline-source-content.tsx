import { createContext, useContext } from "react";

import type { OutlineContent } from "./outline-content.js";
import {
  parseOutlineContent,
  type OutlineInlineExtension,
  type OutlineSourceSpan,
} from "./outline-inline-extension.js";

const InlineExtensions = createContext<readonly OutlineInlineExtension[]>([]);
export const OutlineInlineExtensionsProvider = InlineExtensions.Provider;
export const useOutlineInlineExtensions = () => useContext(InlineExtensions);

function SourceSpan({ span }: Readonly<{ span: OutlineSourceSpan }>) {
  if (span.token !== undefined) {
    // Token renderers can have a different font baseline; their box follows the
    // surrounding line height so entering source text does not resize the line.
    return (
      <span
        className="inline-flex min-h-lh max-w-full items-center align-top [&>*]:min-w-0"
        data-source-end={span.to}
        data-source-start={span.from}
        data-source-token=""
      >
        {span.extension === undefined
          ? span.source
          : span.extension.render({ children: span.text, source: span.source, token: span.token })}
      </span>
    );
  }
  const children =
    span.children === undefined ? (
      <span data-source-start={span.from}>{span.text}</span>
    ) : (
      span.children.map((child) => <SourceSpan key={child.from} span={child} />)
    );
  return span.extension === undefined ? children : span.extension.render({ children, source: span.source });
}

export function OutlineSourceContent({ content }: Readonly<{ content: OutlineContent }>) {
  const extensions = useOutlineInlineExtensions();
  return parseOutlineContent(content, extensions).map((span) => <SourceSpan key={span.from} span={span} />);
}
