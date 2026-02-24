import React, { useCallback, useState } from "react";
import { SpriteResult, ProcessingStatus } from "../types";
import { generateSpriteFromImageFromFile } from "../logic/translation.js";
import { removeLitebritePreview } from "../utils/litebrite/boardCropper";
import SpritePreview from "./SpritePreview";

interface SidePanelProps {
  onSpriteConfirm: (sprite: SpriteResult) => void;
  isSpawning: boolean;
}

const SidePanel: React.FC<SidePanelProps> = ({
  onSpriteConfirm,
  isSpawning,
}) => {
  const [processingState, setProcessingState] = useState<ProcessingStatus>(
    ProcessingStatus.IDLE,
  );
  const [spriteData, setSpriteData] = useState<SpriteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [lowConfidenceWarning, setLowConfidenceWarning] = useState(false);
  const [aiDescription, setAiDescription] = useState<string | null>(null);
  const prevSpawningRef = React.useRef(false);

  // Reset function to clear state
  const resetPanel = useCallback(() => {
    setProcessingState(ProcessingStatus.IDLE);
    setSpriteData(null);
    setError(null);
    setBuildError(null);
    setLowConfidenceWarning(false);
    setAiDescription(null);
    // Reset file input
    const fileInput = document.getElementById("fileInput") as HTMLInputElement;
    if (fileInput) {
      fileInput.value = "";
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
      setBuildError(null);
      setLowConfidenceWarning(false);

      const out = await generateSpriteFromImageFromFile(file);

      if (!out.ok) {
        setSpriteData(null);
        setBuildError((out as { ok: false; error: string }).error);
        setProcessingState(ProcessingStatus.COMPLETE);
      } else {
        setSpriteData(out.result);
        setLowConfidenceWarning(Boolean(out.lowConfidence));
        setAiDescription(out.aiGenerated && out.aiDescription ? out.aiDescription : null);
        setProcessingState(ProcessingStatus.COMPLETE);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
      setProcessingState(ProcessingStatus.ERROR);
    }
  }, []);

  const handleConfirm = useCallback(() => {
    if (spriteData) {
      removeLitebritePreview();
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
        if (file.type.startsWith("image/")) {
          handleFileProcess(file);
        }
      }
    },
    [processingState, handleFileProcess],
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
    <div className="w-80 h-full bg-neutral-900 border-r border-neutral-800 flex flex-col min-h-0 overflow-hidden">
      {/* Upload — compact, fixed height */}
      <div className="flex-shrink-0 p-4 border-b border-neutral-800">
        <h2 className="text-base font-bold text-white mb-6">Upload Sprite</h2>
        <p className="text-sm text-neutral-400 leading-relaxed mb-3">
          Drag and drop an image to convert it to a sprite.
        </p>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className={`border-2 border-dashed rounded-lg p-3 text-center transition-all duration-300 cursor-pointer flex flex-col items-center justify-center min-h-[100px] bg-neutral-800 ${
            isLoading
              ? "border-neutral-700 opacity-60 cursor-not-allowed"
              : "border-neutral-700 hover:border-emerald-500 hover:bg-neutral-700/80"
          }`}
          onClick={() =>
            !isLoading && document.getElementById("fileInput")?.click()
          }
        >
          <input
            type="file"
            id="fileInput"
            className="hidden"
            accept="image/*"
            onChange={handleChange}
            disabled={isLoading}
          />
          <p className="text-white font-medium text-sm">
            Drop Image or Click To Upload
          </p>
          <p className="text-neutral-500 text-xs mt-1.5">PNG, JPG</p>
        </div>
        {lowConfidenceWarning && (
          <div className="mt-3 p-2 bg-amber-900/20 border border-amber-700 text-amber-400 text-xs rounded text-center leading-relaxed">
            Low detection quality. Retake with better lighting.
          </div>
        )}
        {error && (
          <div className="mt-3 p-2 bg-red-900/20 border border-red-800 text-red-400 text-xs rounded text-center leading-relaxed">
            {error}
          </div>
        )}
      </div>

      {/* Loading: Google-style three-dot bounce in center while generating */}
      {isLoading && (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 p-4 border-t border-neutral-800">
          <div className="flex items-center justify-center gap-1.5" aria-hidden>
            <span className="loading-dot" />
            <span className="loading-dot" />
            <span className="loading-dot" />
          </div>
          <p className="text-sm text-neutral-400">
            Hmm, what could this be...?
          </p>
        </div>
      )}

      {/* Generated Sprite Build — description wraps; grids in lower half; or API error */}
      {(spriteData || buildError) && !isLoading && (
        <>
          <div className="flex-1 min-h-0 flex flex-col p-4 border-t border-neutral-800 overflow-hidden">
            <div className="flex-shrink-0">
              <h3 className="text-base font-bold text-white mb-6">
                Generated Sprite Build
              </h3>
              {buildError ? (
                <div className="p-3 bg-red-900/20 border border-red-800 text-red-400 text-sm rounded-lg leading-relaxed">
                  {buildError}
                </div>
              ) : (
                <>
                  {aiDescription && (
                    <div className="text-sm break-words leading-relaxed">
                      <span className="text-neutral-400">
                        We think your creation is{" "}
                      </span>
                      <span className="text-emerald-400/90 font-bold">
                        {aiDescription}.
                      </span>
                      <span className="block text-neutral-400 mt-3">
                        Not quite right? Try uploading another photo!
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
            {spriteData && !buildError && (
              <div className="flex-1 min-h-[50%] flex flex-col min-h-0 mt-1">
                <div className="grid grid-cols-2 gap-3 flex-1 min-h-0 content-end">
                  <SpritePreview
                    pixels={spriteData.matrix.front}
                    label="Front"
                    scale={3}
                  />
                  <SpritePreview
                    pixels={spriteData.matrix.back}
                    label="Back"
                    scale={3}
                  />
                  <SpritePreview
                    pixels={spriteData.matrix.left}
                    label="Left"
                    scale={3}
                  />
                  <SpritePreview
                    pixels={spriteData.matrix.right}
                    label="Right"
                    scale={3}
                  />
                </div>
              </div>
            )}
          </div>
          {spriteData && (
            <div className="flex-shrink-0 p-4 border-t border-neutral-800">
              <button
                onClick={handleConfirm}
                disabled={isSpawning}
                className={`w-full py-2.5 px-3 rounded-lg font-semibold text-sm transition-all duration-200 ${
                  isSpawning
                    ? "bg-neutral-700 text-neutral-500 cursor-not-allowed"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg hover:shadow-emerald-500/50"
                }`}
              >
                {isSpawning ? "Spawning..." : "Add to Party"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SidePanel;
