import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import SidePanel from "../../components/SidePanel";
import { generateMap } from "../../lib/generateMap";
import MapCanvas, { type MapCanvasHandle } from "./MapCanvas";
import { DOOR_PHASE_DURATION, type HouseState } from "../../lib/houseState";
import {
  collectMapImageUrls,
  collectGeneratedSpriteImageUrls,
  createGeneratedSprite,
  collectSpriteImageUrls,
  initSprites,
  updateSprites,
  type Sprite,
} from "../../lib/spriteSystem";
import {
  fetchGeneratedManifest,
  type GeneratedSpriteEntry,
} from "../../lib/generatedSprites";
import {
  HOUSE_COL,
  HOUSE_ROW,
  MAP_COLS,
  MAP_ROWS,
  SPAWN_POINT,
  TILE_SIZE,
  type Tile,
} from "../../lib/mapData";
import {
  CREATIONS_STORAGE_KEY,
  MAX_SAVED_CREATIONS,
  type SpriteResult,
} from "../../types";
import {
  PANEL_CONTENT_FADE_MS,
  PANEL_WIDTH_EASING,
  PANEL_WIDTH_MS,
  SIDE_PANEL_EXPAND_W,
} from "../../constants";
import { ResetSavedCreationsButton } from "../../components/ResetSavedCreationsButton";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

const MAP_NATURAL_WIDTH = MAP_COLS * TILE_SIZE;
const MAP_NATURAL_HEIGHT = MAP_ROWS * TILE_SIZE;

const VIEW_BG = "#1e1e1e";
const DOOR_CENTER_X = HOUSE_COL * TILE_SIZE + TILE_SIZE * 1.5;
const DOOR_CENTER_Y = HOUSE_ROW * TILE_SIZE + TILE_SIZE * 1.8;
const DOOR_TRIGGER_RADIUS_X = TILE_SIZE * 0.52;
const DOOR_TRIGGER_RADIUS_Y = TILE_SIZE * 0.44;

/** Same fixed pixel door-zone logic as spriteSystem house entry. */
function spriteNearDoor(s: Sprite): boolean {
  if (s.insideHouse) return false;
  return (
    Math.abs(s.x - DOOR_CENTER_X) < DOOR_TRIGGER_RADIUS_X &&
    Math.abs(s.y - DOOR_CENTER_Y) < DOOR_TRIGGER_RADIUS_Y
  );
}

function loadImage(src: string): Promise<[string, HTMLImageElement]> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve([src, im]);
    im.onerror = () => reject(new Error(`Failed to load ${src}`));
    im.src = src;
  });
}

function updateMapHouseState(
  hs: HouseState,
  sprites: Sprite[],
  _grid: Tile[][],
  dt: number,
): HouseState {
  const anyInFront = sprites.some((s) => spriteNearDoor(s));
  const spriteInsideHouse = sprites.some((s) => s.insideHouse);

  const tick = (t: number) => t - dt;

  switch (hs.phase) {
    case "closed":
      if (anyInFront) {
        return {
          phase: "opening",
          phaseTimer: DOOR_PHASE_DURATION.opening,
        };
      }
      return hs;

    case "opening": {
      if (spriteInsideHouse) {
        return {
          phase: "closing_in",
          phaseTimer: DOOR_PHASE_DURATION.closing_in,
        };
      }
      if (!anyInFront) {
        return { phase: "closed", phaseTimer: 0 };
      }
      const nt = tick(hs.phaseTimer);
      if (nt <= 0) {
        return { phase: "open", phaseTimer: DOOR_PHASE_DURATION.open };
      }
      return { ...hs, phaseTimer: nt };
    }

    case "open": {
      if (spriteInsideHouse) {
        return {
          phase: "closing_in",
          phaseTimer: DOOR_PHASE_DURATION.closing_in,
        };
      }
      if (!anyInFront) {
        return {
          phase: "closing_out",
          phaseTimer: DOOR_PHASE_DURATION.closing_out,
        };
      }
      // Stay open until they enter or step away — no timeout while still at the door.
      return hs;
    }

    case "closing_in": {
      const nt = tick(hs.phaseTimer);
      if (nt <= 0) {
        return { phase: "inside", phaseTimer: 0 };
      }
      return { ...hs, phaseTimer: nt };
    }

    case "inside":
      if (!spriteInsideHouse) {
        return {
          phase: "opening_out",
          phaseTimer: DOOR_PHASE_DURATION.opening_out,
        };
      }
      return hs;

    case "opening_out": {
      const nt = tick(hs.phaseTimer);
      if (nt <= 0) {
        return { phase: "open_out", phaseTimer: DOOR_PHASE_DURATION.open_out };
      }
      return { ...hs, phaseTimer: nt };
    }

    case "open_out": {
      const nt = tick(hs.phaseTimer);
      if (nt <= 0) {
        return {
          phase: "closing_out",
          phaseTimer: DOOR_PHASE_DURATION.closing_out,
        };
      }
      return { ...hs, phaseTimer: nt };
    }

    case "closing_out": {
      const nt = tick(hs.phaseTimer);
      if (nt <= 0) {
        return { phase: "closed", phaseTimer: 0 };
      }
      return { ...hs, phaseTimer: nt };
    }

    default:
      return hs;
  }
}

export default function MapPage() {
  const reduceMotion = usePrefersReducedMotion();
  const pathname =
    typeof window !== "undefined" ? window.location.pathname : "/";
  const showClearButton = pathname === "/admin" || pathname === "/admin/";
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  /** Persist creation metadata; live sprite also injects optimistically then confirms after save. */
  const handleSpriteConfirmFromMap = useCallback((sprite: SpriteResult) => {
    try {
      const raw = localStorage.getItem(CREATIONS_STORAGE_KEY);
      const list: SpriteResult[] = raw ? JSON.parse(raw) : [];
      list.push(sprite);
      localStorage.setItem(
        CREATIONS_STORAGE_KEY,
        JSON.stringify(list.slice(-MAX_SAVED_CREATIONS)),
      );
    } catch {
      // ignore storage errors
    }
  }, []);
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const [mapAreaSize, setMapAreaSize] = useState({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  const initialHouseState: HouseState = {
    phase: "closed",
    phaseTimer: 0,
  };
  const [grid] = useState(() => generateMap());
  const spritesRef = useRef<Sprite[]>(initSprites(grid, SPAWN_POINT));
  const houseRef = useRef<HouseState>(initialHouseState);
  const [houseState, setHouseState] = useState<HouseState>(initialHouseState);
  const [imageCache, setImageCache] = useState<Record<
    string,
    HTMLImageElement
  > | null>(null);
  const canvasRef = useRef<MapCanvasHandle>(null);

  /**
   * Optimistically injects the new sprite into the live map immediately
   * using in-memory blob/data URLs — before /api/save-sprite completes.
   * This restores the "character appears when overlay closes" behavior.
   */
  const injectSpriteOptimistically = useCallback(
    async (entry: GeneratedSpriteEntry, stateUrls: Record<string, string>) => {
      const pairs: [string, HTMLImageElement][] = [];
      for (const [state, dataUrl] of Object.entries(stateUrls)) {
        if (!dataUrl) continue;
        const assetPath = `/generated-sprites/${entry.id}/${state}.png`;
        try {
          let img: HTMLImageElement;
          try {
            [, img] = await loadImage(dataUrl);
          } catch {
            [, img] = await loadImage(assetPath);
          }
          pairs.push([assetPath, img]);
        } catch {
          // Missing sheet — sprite will be invisible but still in state machine
        }
      }
      if (pairs.length > 0) {
        setImageCache((prev) => ({
          ...(prev ?? {}),
          ...Object.fromEntries(pairs),
        }));
      }
      const newSprite = createGeneratedSprite(entry, grid, spritesRef.current);
      spritesRef.current = [...spritesRef.current, newSprite];
    },
    [grid],
  );

  const handleGeneratedSpriteSaved = useCallback(
    async (entry: GeneratedSpriteEntry) => {
      const urls = collectGeneratedSpriteImageUrls([entry]);
      try {
        const pairs = await Promise.all(urls.map((u) => loadImage(u)));
        setImageCache((prev) => ({ ...(prev ?? {}), ...Object.fromEntries(pairs) }));
      } catch {
        // Keep going so sprite still enters live state; missing images simply won't render.
      }
      const newSprite = createGeneratedSprite(entry, grid, spritesRef.current);
      spritesRef.current = [...spritesRef.current, newSprite];
    },
    [grid],
  );

  const onGeneratedSpriteSavedAfterOptimistic = useCallback(
    async (entry: GeneratedSpriteEntry) => {
      if (
        spritesRef.current.some((s) => s.id === `generated_${entry.id}`)
      ) {
        const urls = collectGeneratedSpriteImageUrls([entry]);
        try {
          const pairs = await Promise.all(urls.map((u) => loadImage(u)));
          setImageCache((prev) => ({
            ...(prev ?? {}),
            ...Object.fromEntries(pairs),
          }));
        } catch {
          // same as handleGeneratedSpriteSaved catch
        }
        return;
      }
      await handleGeneratedSpriteSaved(entry);
    },
    [handleGeneratedSpriteSaved],
  );

  useLayoutEffect(() => {
    if (!imageCache) return;
    const el = mapAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setMapAreaSize({
        width: cr.width,
        height: cr.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [imageCache]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      let entries: GeneratedSpriteEntry[] = [];
      try {
        const manifest = await fetchGeneratedManifest();
        entries = manifest.sprites ?? [];
        const genUrls = collectGeneratedSpriteImageUrls(entries);
        const urls = [
          ...new Set([
            ...collectMapImageUrls(grid),
            ...collectSpriteImageUrls(),
            ...genUrls,
          ]),
        ];
        // allSettled: one missing/broken asset must not skip manifest sprites or wipe spritesRef.
        const results = await Promise.allSettled(
          urls.map((u) => loadImage(u)),
        );
        const pairs: [string, HTMLImageElement][] = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i]!;
          if (r.status === "fulfilled") pairs.push(r.value);
        }
        if (cancelled) return;
        spritesRef.current = initSprites(grid, SPAWN_POINT, entries);
        setImageCache(Object.fromEntries(pairs));
      } catch {
        if (!cancelled) {
          spritesRef.current = initSprites(grid, SPAWN_POINT, entries);
          setImageCache({});
        }
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [grid]);

  useEffect(() => {
    if (!imageCache) return;
    let frameId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 50);
      last = now;
      const phase = houseRef.current.phase;
      const doorEnterAllowed = phase === "opening" || phase === "open";
      updateSprites(
        spritesRef.current,
        dt,
        grid,
        spritesRef.current,
        doorEnterAllowed,
      );
      houseRef.current = updateMapHouseState(
        houseRef.current,
        spritesRef.current,
        grid,
        dt,
      );
      setHouseState(houseRef.current);
      canvasRef.current?.draw(spritesRef.current, houseRef.current.phase, dt);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [imageCache, grid]);

  const fitW =
    mapAreaSize.width > 0
      ? mapAreaSize.width
      : typeof window !== "undefined"
        ? window.innerWidth
        : MAP_NATURAL_WIDTH;
  const fitH =
    mapAreaSize.height > 0
      ? mapAreaSize.height
      : typeof window !== "undefined"
        ? window.innerHeight
        : MAP_NATURAL_HEIGHT;

  const scaleX = fitW / MAP_NATURAL_WIDTH;
  const scaleY = fitH / MAP_NATURAL_HEIGHT;
  const scale = Math.min(scaleX, scaleY);
  const scaledWidth = MAP_NATURAL_WIDTH * scale;
  const scaledHeight = MAP_NATURAL_HEIGHT * scale;
  const offsetX = (fitW - scaledWidth) / 2;
  const offsetY = (fitH - scaledHeight) / 2;

  if (!imageCache) {
    return (
      <div
        className="font-google-sans-code text-neutral-200"
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: VIEW_BG,
          overflow: "hidden",
        }}
      >
        Loading map…
      </div>
    );
  }

  return (
    <div
      data-house-phase={houseState.phase}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        backgroundColor: VIEW_BG,
        overflow: "hidden",
      }}
    >
      <aside
        aria-label="Map tools panel"
        aria-expanded={sidePanelOpen}
        className="font-google-sans-code"
        style={{
          width: sidePanelOpen
            ? "clamp(180px, 28vw, 320px)"
            : SIDE_PANEL_EXPAND_W,
          transition: reduceMotion
            ? "none"
            : `width ${PANEL_WIDTH_MS}ms ${PANEL_WIDTH_EASING}`,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          backgroundColor: "#252525",
          borderRight: "1px solid #333",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        {sidePanelOpen ? (
          <div className="box-border flex w-full shrink-0 items-center justify-between gap-3 px-3 pt-3 pb-3">
            <h2 className="font-google-sans-code min-w-0 flex-1 text-left text-xl font-semibold leading-tight tracking-wide text-neutral-100">
              Block Party
            </h2>
            <button
              type="button"
              onClick={() => setSidePanelOpen(false)}
              aria-label="Collapse side panel"
              className="shrink-0 font-google-sans-code"
              style={{
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #444",
                borderRadius: 6,
                background: "#1a1a1a",
                color: "#e5e5e5",
                cursor: "pointer",
                fontSize: 20,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ) : (
          <div className="box-border flex min-h-[44px] w-full shrink-0 items-center justify-center px-0 py-2">
            <button
              type="button"
              onClick={() => setSidePanelOpen(true)}
              aria-label="Expand side panel"
              className="font-google-sans-code"
              style={{
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #444",
                borderRadius: 6,
                background: "#1a1a1a",
                color: "#e5e5e5",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              ›
            </button>
          </div>
        )}
        <div
          className="font-google-sans-code min-h-0 flex-1 overflow-hidden overflow-y-auto text-neutral-200"
          style={{
            opacity: sidePanelOpen ? 1 : 0,
            transition: reduceMotion
              ? "none"
              : `opacity ${PANEL_CONTENT_FADE_MS}ms ease`,
            pointerEvents: sidePanelOpen ? "auto" : "none",
          }}
        >
          <SidePanel
            onSpriteConfirm={handleSpriteConfirmFromMap}
            isSpawning={false}
            injectSpriteOptimistically={injectSpriteOptimistically}
            onGeneratedSpriteSaved={onGeneratedSpriteSavedAfterOptimistic}
          />
        </div>
      </aside>
      <div
        ref={mapAreaRef}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div className="pointer-events-none absolute right-3 top-3 z-10 font-google-sans-code">
          <ResetSavedCreationsButton
            className="pointer-events-auto rounded-md border border-neutral-700 bg-neutral-900/70 px-2 py-1 text-[11px] text-neutral-300 shadow-lg transition-colors hover:bg-neutral-900/90 hover:text-white"
            showClearButton={showClearButton}
          />
        </div>
        <div
          style={{
            position: "absolute",
            left: offsetX,
            top: offsetY,
            width: MAP_NATURAL_WIDTH,
            height: MAP_NATURAL_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <MapCanvas ref={canvasRef} grid={grid} imageCache={imageCache} />
        </div>
      </div>
    </div>
  );
}
