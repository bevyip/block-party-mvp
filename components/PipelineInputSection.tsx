import React from "react";

/** Same paths as `app/pipeline/page.tsx` (served from `public/`). */
export const PIPELINE_TEST_SCAN_URLS: readonly { url: string; label: string }[] =
  [
    { url: "assets/test/litebrite1.jpeg", label: "Test 1" },
    { url: "assets/test/litebrite2.jpeg", label: "Test 2" },
    { url: "assets/test/litebrite3.jpeg", label: "Test 3" },
  ];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-200/90">
      {children}
    </h2>
  );
}

export type PipelineInputSectionProps = {
  variant?: "default" | "narrow";
  previewUrl: string | null;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectTest: (assetUrl: string) => void;
  /** Defaults to {@link PIPELINE_TEST_SCAN_URLS}. */
  testScans?: readonly { url: string; label: string }[];
  fileInputId?: string;
  accept?: string;
  /** Drag-and-drop on the same bordered card as the pipeline page (no extra dashed frame). */
  dropZoneHandlers?: {
    onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  };
  disabled?: boolean;
  /** When the parent renders its own "Input" header (e.g. collapsible chrome). */
  omitSectionTitle?: boolean;
  children?: React.ReactNode;
};

/**
 * Pipeline “Input” card: test scans, file picker, preview — same as pipeline page,
 * with a narrower layout for the home side panel.
 */
export function PipelineInputSection({
  variant = "default",
  previewUrl,
  onFileChange,
  onSelectTest,
  testScans = PIPELINE_TEST_SCAN_URLS,
  fileInputId = "pipeline-input-file",
  accept = "image/png,image/jpeg",
  dropZoneHandlers,
  disabled = false,
  omitSectionTitle = false,
  children,
}: PipelineInputSectionProps) {
  const narrow = variant === "narrow";

  const cardClassName =
    narrow
      ? "flex min-w-0 flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3"
      : "flex flex-col gap-6 rounded-xl border border-neutral-800 bg-neutral-900/50 p-6";

  const cardInner = (
    <div
      className={cardClassName}
      onDrop={dropZoneHandlers?.onDrop}
      onDragOver={dropZoneHandlers?.onDragOver}
    >
      {!omitSectionTitle && <SectionTitle>Input</SectionTitle>}
      <div className="min-w-0">
        <p
          className={
            narrow
              ? "mb-1.5 text-[10px] text-neutral-500"
              : "mb-2 text-xs text-neutral-500"
          }
        >
          Test scans
        </p>
        <div
          className={
            narrow
              ? "flex flex-wrap gap-2"
              : "flex flex-wrap gap-3"
          }
        >
          {testScans.map(({ url, label }) => (
            <button
              key={url}
              type="button"
              disabled={disabled}
              onClick={() => onSelectTest(url)}
              className={
                narrow
                  ? `group flex min-w-0 flex-col items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-900 p-1.5 transition hover:border-violet-600 ${disabled ? "cursor-not-allowed opacity-50" : ""}`
                  : `group flex flex-col items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 p-2 transition hover:border-violet-600 ${disabled ? "cursor-not-allowed opacity-50" : ""}`
              }
            >
              <img
                src={url}
                alt={label}
                className={
                  narrow
                    ? "h-14 w-14 rounded object-cover ring-1 ring-neutral-700"
                    : "h-20 w-20 rounded object-cover ring-1 ring-neutral-700"
                }
              />
              <span
                className={
                  narrow
                    ? "max-w-[4.5rem] truncate text-[10px] text-neutral-400 group-hover:text-neutral-200"
                    : "text-xs text-neutral-400 group-hover:text-neutral-200"
                }
              >
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <label
          className={
            narrow
              ? "mb-1.5 block text-[10px] text-neutral-500"
              : "mb-2 block text-xs text-neutral-500"
          }
        >
          Custom upload (PNG / JPG)
        </label>
        <input
          id={fileInputId}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={onFileChange}
          className={
            narrow
              ? "block w-full min-w-0 max-w-full text-xs text-neutral-400 file:mr-2 file:rounded-md file:border-0 file:bg-neutral-800 file:px-2 file:py-1.5 file:text-xs file:text-neutral-200 hover:file:bg-neutral-700"
              : "block w-full text-sm text-neutral-400 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-2 file:text-sm file:text-neutral-200 hover:file:bg-neutral-700"
          }
        />
      </div>
      {previewUrl && (
        <div className="min-w-0">
          <p
            className={
              narrow
                ? "mb-1.5 text-[10px] text-neutral-500"
                : "mb-2 text-xs text-neutral-500"
            }
          >
            Preview
          </p>
          <img
            src={previewUrl}
            alt="Selected scan"
            className={
              narrow
                ? "max-h-36 w-full max-w-full rounded-lg border border-neutral-700 object-contain"
                : "max-h-64 max-w-full rounded-lg border border-neutral-700 object-contain"
            }
          />
        </div>
      )}
      {children}
    </div>
  );

  return cardInner;
}
