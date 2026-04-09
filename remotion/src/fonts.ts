import { useState, useEffect } from "react";
import { staticFile, continueRender, delayRender } from "remotion";

const FONT_DEFINITIONS = [
  {
    family: "PixelGame",
    src: "assets/fonts/pixel-game.regular.otf",
    weight: "400",
  },
  {
    family: "PPNeueBit",
    src: "assets/fonts/pp-neue-bit.bold.otf",
    weight: "700",
  },
  {
    family: "DMMono-Regular",
    src: "assets/fonts/dm-mono.regular.ttf",
    weight: "400",
  },
  {
    family: "Circular-LL",
    src: "assets/fonts/circular-ll.regular.ttf",
    weight: "400",
  },
  {
    family: "Circular-LL",
    src: "assets/fonts/circular-ll.medium.ttf",
    weight: "500",
  },
  {
    family: "Circular-LL-Book",
    src: "assets/fonts/circular-ll.book.ttf",
    weight: "450",
  },
] as const;

export function useFonts() {
  const [handle] = useState(() => delayRender("Loading fonts"));

  useEffect(() => {
    Promise.all(
      FONT_DEFINITIONS.map(({ family, src, weight }) => {
        const url = staticFile(src);
        const font = new FontFace(family, `url(${url})`, {
          weight,
          display: "block",
        });
        return font.load().then((loaded) => {
          document.fonts.add(loaded);
        });
      }),
    )
      .then(() => document.fonts.ready)
      .then(() => {
        continueRender(handle);
      });
  }, [handle]);
}
