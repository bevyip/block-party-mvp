import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import GameCanvas, { GameCanvasRef } from "./components/GameCanvas";
import SidePanel from "./components/SidePanel";
import {
  SpriteResult,
  CREATIONS_STORAGE_KEY,
  MAX_SAVED_CREATIONS,
} from "./types";
import { ResetSavedCreationsButton } from "./components/ResetSavedCreationsButton";
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  PANEL_CONTENT_FADE_MS,
  PANEL_WIDTH_EASING,
  PANEL_WIDTH_MS,
  SIDE_PANEL_EXPAND_W,
} from "./constants";
import { usePrefersReducedMotion } from "./hooks/usePrefersReducedMotion";

/** Horizontal margin from `mx-2 md:mx-4` on the game wrapper (desktop-only layout). */
const GAME_WRAPPER_MARGIN_X = 32;

const SMALL_SCREEN_BREAKPOINT = 768;

export default function App() {
  const reduceMotion = usePrefersReducedMotion();
  const gameCanvasRef = useRef<GameCanvasRef>(null);
  const [isSpawning, setIsSpawning] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const mapRowRef = useRef<HTMLDivElement>(null);
  const [mapRowSize, setMapRowSize] = useState({ width: 0, height: 0 });
  const [isSmallScreen, setIsSmallScreen] = useState(
    () =>
      typeof window !== "undefined" &&
      window.innerWidth < SMALL_SCREEN_BREAKPOINT,
  );
  const [pathname, setPathname] = useState<string>(() =>
    typeof window !== "undefined" ? window.location.pathname : "/",
  );

  const isLegacyIndexView =
    pathname === "/legacy.html" ||
    pathname === "/legacy" ||
    pathname === "/legacy/" ||
    pathname === "/archive" ||
    pathname === "/archive/";
  const showSidePanel =
    pathname === "/" || pathname === "/map" || pathname === "/map.html";

  useEffect(() => {
    const mql = window.matchMedia(
      `(max-width: ${SMALL_SCREEN_BREAKPOINT - 1}px)`,
    );
    const handler = () => setIsSmallScreen(mql.matches);
    mql.addEventListener("change", handler);
    handler();
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useLayoutEffect(() => {
    const el = mapRowRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setMapRowSize({ width: cr.width, height: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  const mapScale = useMemo(() => {
    const fitW =
      mapRowSize.width > 0
        ? mapRowSize.width
        : typeof window !== "undefined"
          ? window.innerWidth
          : GAME_WIDTH;
    const fitH =
      mapRowSize.height > 0
        ? mapRowSize.height
        : typeof window !== "undefined"
          ? window.innerHeight
          : GAME_HEIGHT;
    const widthScale = Math.max(0, fitW - GAME_WRAPPER_MARGIN_X) / GAME_WIDTH;
    const heightScale = Math.max(0, fitH - (isLegacyIndexView ? 16 : 96)) / GAME_HEIGHT;
    return Math.min(1, widthScale, heightScale);
  }, [mapRowSize, isLegacyIndexView]);

  const addSpriteToMap = useCallback(async (spriteResult: SpriteResult) => {
    if (!gameCanvasRef.current) return;
    setIsSpawning(true);
    try {
      await gameCanvasRef.current.addCustomSprite(spriteResult);
      try {
        const raw = localStorage.getItem(CREATIONS_STORAGE_KEY);
        const list: SpriteResult[] = raw ? JSON.parse(raw) : [];
        list.push(spriteResult);
        const trimmed = list.slice(-MAX_SAVED_CREATIONS);
        localStorage.setItem(CREATIONS_STORAGE_KEY, JSON.stringify(trimmed));
      } catch {
        // ignore storage errors
      }
    } finally {
      setIsSpawning(false);
    }
  }, []);

  const handleSpriteConfirm = useCallback(
    (spriteResult: SpriteResult) => {
      void addSpriteToMap(spriteResult);
    },
    [addSpriteToMap],
  );

  if (isSmallScreen) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-neutral-900 p-6">
        <p className="text-neutral-400 text-center text-lg font-medium max-w-sm">
          For the best experience, this web app is best viewed on a larger
          device (tablet or desktop).
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-neutral-900 flex flex-row">
      {showSidePanel && (
        <aside
          aria-label="Sprite tools panel"
          aria-expanded={sidePanelOpen}
          className="font-google-sans-code text-neutral-200"
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
                className="shrink-0"
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
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              opacity: sidePanelOpen ? 1 : 0,
              transition: reduceMotion
                ? "none"
                : `opacity ${PANEL_CONTENT_FADE_MS}ms ease`,
              pointerEvents: sidePanelOpen ? "auto" : "none",
            }}
          >
            <SidePanel
              onSpriteConfirm={handleSpriteConfirm}
              isSpawning={isSpawning}
            />
          </div>
        </aside>
      )}

      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        <main
          className={`flex-1 min-h-0 min-w-0 flex flex-col items-center px-4 md:px-8 overflow-hidden ${
            isLegacyIndexView
              ? "justify-center py-2 md:py-3"
              : "justify-start pt-6 md:pt-8 pb-2 md:pb-4 overflow-y-auto overflow-x-hidden"
          }`}
        >
          {!isLegacyIndexView && (
            <header className="flex-shrink-0 text-center mb-3 md:mb-4">
              <h1 className="text-xl text-neutral-400 font-bold font-google-sans-code tracking-widest uppercase">
                Block Party
              </h1>
              <p className="text-xs text-neutral-500 font-google-sans-code mt-0.5">
                Upload an image to create a sprite and join the party!
              </p>
              <p className="mt-2 font-google-sans-code">
                <ResetSavedCreationsButton />
              </p>
            </header>
          )}
          <div
            ref={mapRowRef}
            className={`flex-1 min-h-0 w-full min-w-0 max-w-full flex items-center ${
              isLegacyIndexView ? "justify-center" : "justify-start"
            }`}
          >
            <div
              className="rounded-xl overflow-hidden border-4 border-white shadow-[0_0_20px_rgba(255,255,255,0.3)] bg-black relative flex-shrink-0 mx-2 md:mx-4 max-w-[calc(100%-1rem)] md:max-w-[calc(100%-2rem)]"
              style={{
                width: GAME_WIDTH * mapScale,
                height: GAME_HEIGHT * mapScale,
              }}
            >
              <div
                style={{
                  width: GAME_WIDTH,
                  height: GAME_HEIGHT,
                  transformOrigin: "top left",
                  transform: `scale(${mapScale})`,
                }}
              >
                <GameCanvas ref={gameCanvasRef} />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
