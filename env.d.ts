/// <reference types="vite/client" />

declare module "virtual:cards-gallery" {
  /** Public `/cards/…` URLs sorted like the gallery: `CARD.png`, `CARD (1)`…`CARD (n)`, legacy `upload-*`, then other. */
  export const CARD_URLS: readonly string[];
}
