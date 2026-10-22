type CaretCandidate = Readonly<{ offset: number; x: number; y: number }>;

export function caretOffsetAtPoint(root: HTMLElement, clientX: number, clientY: number): number {
  const candidates: CaretCandidate[] = [];
  const range = root.ownerDocument.createRange();
  let offset = 0;
  const visit = (node: Node) => {
    if (node instanceof Element && node.hasAttribute("data-source-token")) {
      offset = Number(node.getAttribute("data-source-start"));
      const end = Number(node.getAttribute("data-source-end"));
      const bounds = node.getBoundingClientRect();
      const y = bounds.top + bounds.height / 2;
      candidates.push({ offset, x: bounds.left, y }, { offset: end, x: bounds.right, y });
      offset = end;
      return;
    }
    if (node instanceof Element && node.hasAttribute("data-source-start")) {
      offset = Number(node.getAttribute("data-source-start"));
    }
    if (node instanceof Text) {
      for (let index = 0; index < node.data.length; index += 1) {
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        for (const bounds of range.getClientRects()) {
          const y = bounds.top + bounds.height / 2;
          candidates.push(
            { offset: offset + index, x: bounds.left, y },
            { offset: offset + index + 1, x: bounds.right, y },
          );
        }
      }
      offset += node.data.length;
      return;
    }
    for (const child of node.childNodes) {
      visit(child);
    }
  };
  visit(root);
  if (candidates.length === 0) {
    return 0;
  }
  return candidates.reduce((closest, candidate) => {
    const distance = (candidate.x - clientX) ** 2 + (candidate.y - clientY) ** 2;
    const closestDistance = (closest.x - clientX) ** 2 + (closest.y - clientY) ** 2;
    return distance < closestDistance ? candidate : closest;
  }).offset;
}

/** Reads the full source range; browser offsets belong to individual DOM nodes. */
export function sourceSelection(root: HTMLElement): Readonly<{ from: number; to: number }> | null {
  const selection = root.ownerDocument.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  ) {
    return null;
  }
  const length = (node: Node): number => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent?.length ?? 0;
    }
    if (node instanceof Element && node.tagName === "BR") {
      return node.classList.contains("ProseMirror-trailingBreak") ? 0 : 1;
    }
    return Array.from(node.childNodes).reduce((sum, child) => sum + length(child), 0);
  };
  const offset = (target: Node, at: number): number => {
    let result = 0;
    const visit = (node: Node): boolean => {
      if (node === target) {
        result +=
          node.nodeType === Node.TEXT_NODE
            ? at
            : Array.from(node.childNodes)
                .slice(0, at)
                .reduce((sum, child) => sum + length(child), 0);
        return true;
      }
      if (!node.contains(target)) {
        result += length(node);
        return false;
      }
      return Array.from(node.childNodes).some(visit);
    };
    visit(root);
    return result;
  };
  const anchor = offset(selection.anchorNode, selection.anchorOffset),
    focus = offset(selection.focusNode, selection.focusOffset);
  return { from: Math.min(anchor, focus), to: Math.max(anchor, focus) };
}
