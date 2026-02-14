import React, { useRef, useState } from 'react';
import { GameCanvas, GameCanvasRef } from './components/GameCanvas';
import SidePanel from './components/SidePanel';
import { SpriteResult } from './types';

export default function App() {
  const gameCanvasRef = useRef<GameCanvasRef>(null);
  const [isSpawning, setIsSpawning] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

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

  return (
    <div className="min-h-screen bg-neutral-900 flex relative">
      {/* Backdrop overlay for mobile */}
      {isPanelOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setIsPanelOpen(false)}
        />
      )}

      {/* Side Panel */}
      <div
        className={`fixed left-0 top-0 h-full z-40 transition-transform duration-300 ease-in-out w-full md:w-80 ${
          isPanelOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidePanel onSpriteConfirm={handleSpriteConfirm} isSpawning={isSpawning} />
      </div>
      
      {/* Toggle Button */}
      <button
        onClick={() => setIsPanelOpen(!isPanelOpen)}
        className={`fixed top-4 z-50 bg-neutral-800 hover:bg-neutral-700 text-white p-2 rounded-lg border border-neutral-700 transition-all duration-300 shadow-lg ${
          isPanelOpen ? 'left-[calc(100%-3.5rem)] md:left-[21rem]' : 'left-4'
        }`}
        aria-label={isPanelOpen ? 'Close panel' : 'Open panel'}
      >
        {isPanelOpen ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>
      
      {/* Main Content */}
      <div className={`flex-1 flex flex-col items-center justify-center p-4 transition-all duration-300 ${
        isPanelOpen ? 'ml-80 md:ml-80' : 'ml-0'
      } ${isPanelOpen ? 'hidden md:flex' : 'flex'}`}>
        <div className="max-w-7xl w-full">
          <header className="mb-4 text-center">
            <h1 className="text-2xl text-neutral-400 font-bold font-google-sans-code tracking-widest uppercase">
              Sprite Party
            </h1>
            <p className="text-xs text-neutral-500 font-google-sans-code mt-1">
              Upload an image to create a sprite and join the party!
            </p>
          </header>
          <main className="w-full">
            <GameCanvas ref={gameCanvasRef} isSpawning={isSpawning} />
          </main>
        </div>
      </div>
    </div>
  );
}

