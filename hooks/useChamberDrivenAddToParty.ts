import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
} from "react";
import {
  useMapChannel,
  type PipelineStage,
} from "./usePipelineChannel";

export type UseChamberDrivenAddToPartyArgs = {
  /**
   * Set true when the handoff starts (manual or auto). Cleared when chamber
   * count drops below 3 or when `resetChamberDrivenAddToParty` runs.
   */
  addToPartyLockRef: MutableRefObject<boolean>;
  /** All idle / walk / custom generations finished (`done`). */
  stage3bReady: boolean;
  /** Strip + context ready to run the overlay and save. */
  canBeginAddToParty: boolean;
  /** Overlay open or persistence in flight (surface-specific). */
  isAddToPartyBlocked: boolean;
  /** Broadcast splay + schedule overlay; should set `addToPartyLockRef` at start. */
  onBeginAddToParty: () => void;
  /** When false, ignores chamber sync (e.g. idle shell with no active run). */
  enabled?: boolean;
};

/**
 * When `stage3b_chambers_sync` reports 3 filled chambers and local Stage 3B
 * generations are complete, starts the same add-to-party handoff as the
 * manual button (map `SidePanel` only; pipeline stays on `/pipeline` without
 * mounting `AddToPartyOverlay`).
 */
export function useChamberDrivenAddToParty({
  addToPartyLockRef,
  stage3bReady,
  canBeginAddToParty,
  isAddToPartyBlocked,
  onBeginAddToParty,
  enabled = true,
}: UseChamberDrivenAddToPartyArgs) {
  const lastChamberCountRef = useRef(0);

  const tryTrigger = useCallback(() => {
    if (!enabled) return;
    if (addToPartyLockRef.current) return;
    if (lastChamberCountRef.current < 3) return;
    if (!stage3bReady) return;
    if (!canBeginAddToParty) return;
    if (isAddToPartyBlocked) return;
    onBeginAddToParty();
  }, [
    enabled,
    addToPartyLockRef,
    stage3bReady,
    canBeginAddToParty,
    isAddToPartyBlocked,
    onBeginAddToParty,
  ]);

  useMapChannel(
    useCallback(
      (event: PipelineStage) => {
        if (!enabled) return;
        if (event.stage !== "stage3b_chambers_sync") return;
        const count = Math.max(
          0,
          Math.min(3, Math.floor(event.payload.count)),
        );
        lastChamberCountRef.current = count;
        if (count < 3) {
          addToPartyLockRef.current = false;
          return;
        }
        tryTrigger();
      },
      [enabled, tryTrigger, addToPartyLockRef],
    ),
  );

  useEffect(() => {
    tryTrigger();
  }, [stage3bReady, tryTrigger]);

  const resetChamberDrivenAddToParty = useCallback(() => {
    lastChamberCountRef.current = 0;
    addToPartyLockRef.current = false;
  }, [addToPartyLockRef]);

  return { resetChamberDrivenAddToParty };
}
