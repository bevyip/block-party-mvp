import React, { useCallback, useEffect, useRef, useState } from "react";
import GameCanvas, { GameCanvasRef } from "./components/GameCanvas";
import SidePanel from "./components/SidePanel";
import { SpriteResult } from "./types";
import { GAME_WIDTH, GAME_HEIGHT } from "./constants";

const SIDEBAR_WIDTH_PX = 320; // md:w-80 = 20rem
const SMALL_SCREEN_BREAKPOINT = 768;

export default function App() {
  const gameCanvasRef = useRef<GameCanvasRef>(null);
  const [isSpawning, setIsSpawning] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [mapScale, setMapScale] = useState(1);
  const [isSmallScreen, setIsSmallScreen] = useState(
    () => typeof window !== "undefined" && window.innerWidth < SMALL_SCREEN_BREAKPOINT
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${SMALL_SCREEN_BREAKPOINT - 1}px)`);
    const handler = () => setIsSmallScreen(mql.matches);
    mql.addEventListener("change", handler);
    handler();
    return () => mql.removeEventListener("change", handler);
  }, []);

  const updateMapScale = useCallback(() => {
    const sidebarWidth =
      isPanelOpen && window.innerWidth >= 768 ? SIDEBAR_WIDTH_PX : 0;
    const availableWidth = window.innerWidth - sidebarWidth;
    setMapScale(Math.min(1, availableWidth / GAME_WIDTH));
  }, [isPanelOpen]);

  useEffect(() => {
    updateMapScale();
    window.addEventListener("resize", updateMapScale);
    return () => window.removeEventListener("resize", updateMapScale);
  }, [updateMapScale]);

  const handleSpriteConfirm = async (spriteResult: SpriteResult) => {
    // Add the sprite to the game when user confirms
    if (gameCanvasRef.current) {
      setIsSpawning(true);
      try {
        await gameCanvasRef.current.addCustomSprite(spriteResult);
      } finally {
        setIsSpawning(false);
      }
    }
  };

  if (isSmallScreen) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-neutral-900 p-6">
        <p className="text-neutral-400 text-center text-lg font-medium max-w-sm">
          For the best experience, this web app is best viewed on a larger device
          (tablet or desktop).
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-neutral-900 flex">
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

      {/* Main Content — map + header fill viewport */}
      <div
        className={`flex-1 min-w-0 min-h-0 flex flex-col transition-all duration-300 ${
          isPanelOpen ? "hidden md:flex" : "flex"
        }`}
      >
        <header className="flex-shrink-0 py-2 px-4 text-center">
          <h1 className="text-xl text-neutral-400 font-bold font-google-sans-code tracking-widest uppercase">
            Block Party
          </h1>
          <p className="text-xs text-neutral-500 font-google-sans-code mt-0.5">
            Upload an image to create a sprite and join the party!
          </p>
        </header>
        <main className="flex-1 min-h-0 flex items-center justify-center py-2 md:py-4 px-4 md:px-8">
          <div className="w-full h-full max-w-7xl flex items-center justify-center min-w-0 min-h-0">
            {/* Map: fixed GAME_WIDTH×GAME_HEIGHT, scale down uniformly when viewport is narrow */}
            <div
              className="rounded-xl overflow-hidden border-4 border-white shadow-[0_0_20px_rgba(255,255,255,0.3)] bg-black relative flex-shrink-0 mx-2 md:mx-4"
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
