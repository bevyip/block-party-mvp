import React from "react";

/** Checkerboard behind sprites so transparency reads clearly (same as pipeline page). */
export const SPRITE_CHECKERBOARD_STYLE: React.CSSProperties = {
  backgroundImage: [
    "linear-gradient(45deg, #ccc 25%, transparent 25%)",
    "linear-gradient(-45deg, #ccc 25%, transparent 25%)",
    "linear-gradient(45deg, transparent 75%, #ccc 75%)",
    "linear-gradient(-45deg, transparent 75%, #ccc 75%)",
  ].join(", "),
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
  backgroundColor: "white",
};

const DIR_LABELS = ["Down", "Left", "Right", "Up"] as const;

/** Sprite strip scales to container width; checkerboard shows transparency after BG removal. */
export function SpriteStripView({
  spriteImageUrl,
  compact = false,
}: {
  spriteImageUrl: string;
  /** Less padding around the strip + labels (e.g. side panel). */
  compact?: boolean;
}) {
  return (
    <div dir="ltr" className={`w-full min-w-0 max-w-full overflow-hidden`}>
      <div
        className="mx-auto w-full min-w-0 max-w-full overflow-hidden rounded-sm"
        style={SPRITE_CHECKERBOARD_STYLE}
      >
        <img
          src={spriteImageUrl}
          alt="Generated sprite strip (four directions)"
          draggable={false}
          className="block h-auto w-full min-w-0 max-w-full bg-transparent"
          style={{ imageRendering: "pixelated" }}
        />
      </div>
      <div className="mt-2 flex w-full min-w-0 font-google-sans-code text-xs text-neutral-400">
        {DIR_LABELS.map((label) => (
          <div key={label} className="flex-1 text-center">
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
