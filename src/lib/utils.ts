import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge must know our custom type scale (globals.css `--text-*`); otherwise it would read
// `text-body` as a color and drop it when merged with `text-ink`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "footnote", "subhead", "body", "headline", "title", "large-title"],
      radius: ["control", "card", "sheet"],
      shadow: ["card", "raised", "sheet"],
    },
  },
});

/** Joins class names and resolves Tailwind conflicts (last one wins). */
export function cx(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
