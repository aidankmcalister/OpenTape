import { createCn } from "cn/config";

/**
 * Joins class names, letting later Tailwind classes win over earlier ones. It knows the design
 * tokens in index.css, so `text-ui` counts as a font size rather than a colour, and isn't dropped
 * next to `text-foreground`.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["ui", "caption", "micro"] }],
      shadow: [{ shadow: ["pill", "stage", "popover", "pressed"] }],
    },
  },
});
