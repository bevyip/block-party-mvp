/// <reference types="vite/client" />

declare module "virtual:cards-gallery" {
  /** Public URLs such as `/cards/template.png`, sorted by Figma-style `(n)` order. */
  export const CARD_URLS: readonly string[];
}
