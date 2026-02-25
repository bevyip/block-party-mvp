import React, { useCallback, useEffect, useRef, useState } from "react";
import GameCanvas, { GameCanvasRef } from "./components/GameCanvas";
import SidePanel from "./components/SidePanel";
import { VoxelRevealOverlay } from "./components/VoxelRevealOverlay";
import {
  SpriteResult,
  CREATIONS_STORAGE_KEY,
  MAX_SAVED_CREATIONS,
} from "./types";
import type { PegGrid } from "./utils/litebrite/types";
import { ensurePreviewContainerExists } from "./utils/litebrite/boardCropper";
import { GAME_WIDTH, GAME_HEIGHT } from "./constants";

function spriteMatrixToPegGrid(view: string[][]): PegGrid {
  return view.map((row) => row.map((c) => (c === "transparent" ? null : c)));
}

const SIDEBAR_WIDTH_PX = 320; // md:w-80 = 20rem
const SMALL_SCREEN_BREAKPOINT = 768;

export default function App() {
  const gameCanvasRef = useRef<GameCanvasRef>(null);
  const pendingSpriteRef = useRef<SpriteResult | null>(null);
  const [isSpawning, setIsSpawning] = useState(false);
  const [showVoxelReveal, setShowVoxelReveal] = useState(false);
  const [pendingSprite, setPendingSprite] = useState<SpriteResult | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [mapScale, setMapScale] = useState(1);
  const [isSmallScreen, setIsSmallScreen] = useState(
    () =>
      typeof window !== "undefined" &&
      window.innerWidth < SMALL_SCREEN_BREAKPOINT,
  );

  useEffect(() => {
    const mql = window.matchMedia(
      `(max-width: ${SMALL_SCREEN_BREAKPOINT - 1}px)`,
    );
    const handler = () => setIsSmallScreen(mql.matches);
    mql.addEventListener("change", handler);
    handler();
    return () => mql.removeEventListener("change", handler);
  }, []);

  const updateMapScale = useCallback(() => {
    const sidebarWidth =
      isPanelOpen && window.innerWidth >= 768 ? SIDEBAR_WIDTH_PX : 0;
    // Reserve space for main padding (px-4/px-8) and canvas margins (mx-2/mx-4) so canvas stays within container
    const paddingAndMargin = 96;
    const availableWidth = Math.max(
      0,
      window.innerWidth - sidebarWidth - paddingAndMargin,
    );
    setMapScale(Math.min(1, availableWidth / GAME_WIDTH));
  }, [isPanelOpen]);

  useEffect(() => {
    updateMapScale();
    window.addEventListener("resize", updateMapScale);
    return () => window.removeEventListener("resize", updateMapScale);
  }, [updateMapScale]);

  useEffect(() => {
    ensurePreviewContainerExists();
  }, []);

  useEffect(() => {
    if (showVoxelReveal) document.body.classList.add("voxel-overlay-active");
    else document.body.classList.remove("voxel-overlay-active");
    return () => document.body.classList.remove("voxel-overlay-active");
  }, [showVoxelReveal]);

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

  const handleSpriteConfirm = useCallback((spriteResult: SpriteResult) => {
    pendingSpriteRef.current = spriteResult;
    setPendingSprite(spriteResult);
    setShowVoxelReveal(true);
  }, []);

  const handleVoxelRevealComplete = useCallback(() => {
    const toAdd = pendingSpriteRef.current;
    setShowVoxelReveal(false);
    setPendingSprite(null);
    pendingSpriteRef.current = null;
    if (toAdd) void addSpriteToMap(toAdd);
  }, [addSpriteToMap]);

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
    <div className="h-screen overflow-hidden bg-neutral-900 flex">
      {showVoxelReveal && pendingSprite && (
        <VoxelRevealOverlay
          frontGrid={spriteMatrixToPegGrid(pendingSprite.matrix.front)}
          sideGrid={spriteMatrixToPegGrid(pendingSprite.matrix.left)}
          onComplete={handleVoxelRevealComplete}
        />
      )}

      {/* Backdrop overlay for mobile */}
      {isPanelOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setIsPanelOpen(false)}
        />
      )}

      {/* Side Panel — fixed width when open, fills height, no scroll */}
      <div
        className={`flex-shrink-0 h-full z-40 transition-[transform,width] duration-300 ease-in-out ${
          isPanelOpen
            ? "w-full md:w-80 translate-x-0"
            : "w-0 -translate-x-full md:translate-x-0 overflow-hidden"
        }`}
      >
        <SidePanel
          onSpriteConfirm={handleSpriteConfirm}
          isSpawning={isSpawning}
        />
      </div>

      {/* Toggle Button */}
      <button
        onClick={() => setIsPanelOpen(!isPanelOpen)}
        className={`fixed top-4 z-50 bg-neutral-800 hover:bg-neutral-700 text-white p-2 rounded-lg border border-neutral-700 transition-all duration-300 shadow-lg ${
          isPanelOpen ? "left-[calc(100%-3.5rem)] md:left-[21rem]" : "left-4"
        }`}
        aria-label={isPanelOpen ? "Close panel" : "Open panel"}
      >
        {isPanelOpen ? (
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        ) : (
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        )}
      </button>

      {/* Main Content */}
      <div
        className={`flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden transition-all duration-300 ${
          isPanelOpen ? "hidden md:flex" : "flex"
        }`}
      >
        <main className="flex-1 min-h-0 min-w-0 flex flex-col items-center justify-start pt-6 md:pt-8 pb-2 md:pb-4 px-4 md:px-8 overflow-y-auto overflow-x-hidden">
          <header className="flex-shrink-0 text-center mb-3 md:mb-4">
            <h1 className="text-xl text-neutral-400 font-bold font-google-sans-code tracking-widest uppercase">
              Block Party
            </h1>
            <p className="text-xs text-neutral-500 font-google-sans-code mt-0.5">
              Upload an image to create a sprite and join the party!
            </p>
          </header>
          <div className="flex-1 min-h-0 w-full min-w-0 max-w-full flex items-center justify-start">
            {/* Map: fixed GAME_WIDTH×GAME_HEIGHT, scale down uniformly when viewport is narrow */}
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
