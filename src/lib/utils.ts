import { createCn } from "cn/config";

export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["heading", "ui", "caption", "micro"] }],
      shadow: [{ shadow: ["pill", "stage", "popover", "pressed"] }],
    },
  },
});
