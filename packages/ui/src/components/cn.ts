import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The Lode type scale replaces Tailwind's default font-size names, so
// tailwind-merge must learn them or it treats `text-body` as a text color.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["caption", "label", "body", "body-large", "title-small", "title", "page-title", "display"] },
      ],
    },
  },
});

export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}
