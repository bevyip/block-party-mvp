import React, { useCallback, useState } from 'react';
import { SpriteResult, ProcessingStatus } from '../types';
import { generateSpriteFromImageFromFile } from '../logic/translation.js';
import SpritePreview from './SpritePreview';

interface SidePanelProps {
  onSpriteConfirm: (sprite: SpriteResult) => void;
  isSpawning: boolean;
}

const SidePanel: React.FC<SidePanelProps> = ({ onSpriteConfirm, isSpawning }) => {
  const [processingState, setProcessingState] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [spriteData, setSpriteData] = useState<SpriteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lowConfidenceWarning, setLowConfidenceWarning] = useState(false);
  const [aiDescription, setAiDescription] = useState<string | null>(null);
  const prevSpawningRef = React.useRef(false);

  const geminiConfigured = Boolean(
    typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { VITE_GEMINI_API_KEY?: string } }).env?.VITE_GEMINI_API_KEY
  );

  // Reset function to clear state
  const resetPanel = useCallback(() => {
    setProcessingState(ProcessingStatus.IDLE);
    setSpriteData(null);
    setError(null);
    setLowConfidenceWarning(false);
    setAiDescription(null);
    // Reset file input
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }, []);

  // Reset panel when spawning completes (transitions from true to false)
  React.useEffect(() => {
    if (prevSpawningRef.current && !isSpawning) {
      // Spawning just completed, reset the panel
      resetPanel();
    }
    prevSpawningRef.current = isSpawning;
  }, [isSpawning, resetPanel]);

  const handleFileProcess = useCallback(async (file: File) => {
    try {
      setProcessingState(ProcessingStatus.PROCESSING);
      setError(null);
      setLowConfidenceWarning(false);

      const { result, lowConfidence, aiGenerated, aiDescription: desc } = await generateSpriteFromImageFromFile(file);

      setSpriteData(result);
      setLowConfidenceWarning(Boolean(lowConfidence));
      setAiDescription(aiGenerated && desc ? desc : null);
      setProcessingState(ProcessingStatus.COMPLETE);
    } catch (err: any) {
      setError(err.message || "An unknown error occurred");
      setProcessingState(ProcessingStatus.ERROR);
    }
  }, []);

  const handleConfirm = useCallback(() => {
    if (spriteData) {
      onSpriteConfirm(spriteData);
    }
  }, [spriteData, onSpriteConfirm]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (processingState === ProcessingStatus.PROCESSING) return;

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.type.startsWith('image/')) {
          handleFileProcess(file);
        }
      }
    },
    [processingState, handleFileProcess]
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileProcess(e.target.files[0]);
    }
  };

  const isLoading = processingState === ProcessingStatus.PROCESSING;

  return (
    <div className="w-80 bg-neutral-900 border-r border-neutral-800 flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-neutral-800">
        <h2 className="text-lg font-bold text-white mb-2">Upload Sprite</h2>
        <p className="text-xs text-neutral-400">
          Drag and drop an image to convert it to a sprite
        </p>
      </div>

      <div className="p-4">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className={`border-2 border-dashed rounded-xl p-4 text-center transition-all duration-300 cursor-pointer flex flex-col items-center justify-center min-h-[120px] bg-neutral-800 ${
            isLoading
              ? 'border-neutral-700 opacity-60 cursor-not-allowed'
              : 'border-neutral-700 hover:border-emerald-500 hover:bg-neutral-700/80'
          }`}
          onClick={() => !isLoading && document.getElementById('fileInput')?.click()}
        >
          <input
            type="file"
            id="fileInput"
            className="hidden"
            accept="image/*"
            onChange={handleChange}
            disabled={isLoading}
          />
          <div className="text-3xl mb-2 grayscale opacity-80">👾</div>
          <p className="text-white font-semibold text-sm">
            {isLoading ? (geminiConfigured ? 'Analyzing with AI...' : 'Processing...') : 'Drop Image Here'}
          </p>
          <p className="text-neutral-500 text-xs mt-1">
            PNG, JPG (Max 2MB recommended)
          </p>
        </div>

        {lowConfidenceWarning && (
          <div className="mt-4 p-3 bg-amber-900/20 border border-amber-700 text-amber-400 text-xs rounded text-center">
            Low detection quality. For best results with Lite Brite photos, retake with better lighting or a clearer grid.
          </div>
        )}
        {error && (
          <div className="mt-4 p-3 bg-red-900/20 border border-red-800 text-red-400 text-xs rounded text-center">
            Error: {error}
          </div>
        )}
      </div>

      {spriteData && (
        <>
          <div className="p-4 border-t border-neutral-800">
            <h3 className="text-sm font-bold text-white mb-3">Generated Sprite Build</h3>
            {aiDescription && (
              <p className="text-xs text-emerald-400/90 mb-2 break-words whitespace-normal">
                ✨ {aiDescription}
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <SpritePreview
                pixels={spriteData.matrix.front}
                label="Front"
              />
              <SpritePreview
                pixels={spriteData.matrix.back}
                label="Back"
              />
              <SpritePreview
                pixels={spriteData.matrix.left}
                label="Left"
              />
              <SpritePreview
                pixels={spriteData.matrix.right}
                label="Right"
              />
            </div>
          </div>
          <div className="p-4 border-t border-neutral-800 mt-auto">
            <button
              onClick={handleConfirm}
              disabled={isSpawning}
              className={`w-full py-3 px-4 rounded-lg font-semibold text-sm transition-all duration-200 ${
                isSpawning
                  ? 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg hover:shadow-emerald-500/50'
              }`}
            >
              {isSpawning ? 'Spawning...' : 'Add to Party'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default SidePanel;

