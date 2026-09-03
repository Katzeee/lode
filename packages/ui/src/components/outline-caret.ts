type CaretCandidate = Readonly<{ offset: number; x: number; y: number }>;

export function caretOffsetAtPoint(root: HTMLElement, clientX: number, clientY: number): number {
  const candidates: CaretCandidate[] = [];
  const range = root.ownerDocument.createRange();
  let offset = 0;
  const visit = (node: Node) => {
    if (node instanceof Element && node.getAttribute("data-ui") === "outline-reference") {
      const bounds = node.getBoundingClientRect();
      const y = bounds.top + bounds.height / 2;
      candidates.push({ offset, x: bounds.left, y }, { offset: offset + 1, x: bounds.right, y });
      offset += 1;
      return;
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
