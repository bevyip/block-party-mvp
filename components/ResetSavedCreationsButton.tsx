import React, { useCallback } from "react";
import { CREATIONS_STORAGE_KEY } from "../types";

const DOCS_URL =
  "https://bevyip.notion.site/block-party-thesis?source=copy_link";

type Props = {
  className?: string;
  label?: string;
  showClearButton?: boolean;
};

/**
 * Replaces the legacy “Reset map” control that lived on the fixed Lite-Brite toolbar
 * (`#litebrite-preview-container`) when that UI is hidden in favor of the side panel.
 */
export function ResetSavedCreationsButton({
  className = "text-[11px] text-neutral-500 hover:text-neutral-300 underline-offset-2 hover:underline",
  label = "CLEAR",
  showClearButton = true,
}: Props) {
  const onDocsClick = useCallback(() => {
    window.open(DOCS_URL, "_blank", "noopener,noreferrer");
  }, []);

  const onClick = useCallback(async () => {
    try {
      localStorage.removeItem(CREATIONS_STORAGE_KEY);
    } catch {
      // ignore
    }
    try {
      await fetch("/api/clear-sprites", { method: "POST" });
    } catch {
      // ignore
    }
    // Only reload after server-side clearing completes.
    window.location.href = window.location.href;
  }, []);

  return (
    <div className="pointer-events-auto inline-flex items-center gap-1">
      <button
        type="button"
        title="Documentation"
        aria-label="Documentation"
        className={`${className} inline-flex !h-6 !w-6 cursor-pointer items-center justify-center !rounded-full !p-0 !px-0 !py-0 text-xs leading-none transition-colors hover:no-underline`}
        onClick={onDocsClick}
      >
        ?
      </button>
      {showClearButton && (
        <button
          type="button"
          title="Clear All Creations"
          className={`${className} inline-flex cursor-pointer items-center rounded px-2 py-1`}
          onClick={onClick}
        >
          {label}
        </button>
      )}
    </div>
  );
}
