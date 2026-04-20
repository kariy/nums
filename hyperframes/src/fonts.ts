const FONT_DEFINITIONS = [
  {
    family: "PixelGame",
    src: "/assets/fonts/pixel-game.regular.otf",
    weight: "400",
  },
  {
    family: "PPNeueBit",
    src: "/assets/fonts/pp-neue-bit.bold.otf",
    weight: "700",
  },
  {
    family: "DMMono-Regular",
    src: "/assets/fonts/dm-mono.regular.ttf",
    weight: "400",
  },
  {
    family: "Circular-LL",
    src: "/assets/fonts/circular-ll.regular.ttf",
    weight: "400",
  },
  {
    family: "Circular-LL",
    src: "/assets/fonts/circular-ll.medium.ttf",
    weight: "500",
  },
  {
    family: "Circular-LL-Book",
    src: "/assets/fonts/circular-ll.book.ttf",
    weight: "450",
  },
] as const;

export async function loadFonts(): Promise<void> {
  await Promise.all(
    FONT_DEFINITIONS.map(async ({ family, src, weight }) => {
      const font = new FontFace(family, `url(${src})`, {
        weight,
        display: "block",
      });
      const loaded = await font.load();
      document.fonts.add(loaded);
    }),
  );
  await document.fonts.ready;
}
