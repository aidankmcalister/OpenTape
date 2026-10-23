import { createCn } from "cn/config";

// So `text-ui` counts as a font size and isn't dropped next to `text-foreground`.
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["ui", "caption", "micro"] }],
      shadow: [{ shadow: ["pill", "stage", "popover", "pressed"] }],
    },
  },
});
