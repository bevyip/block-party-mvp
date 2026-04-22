import { useEffect, useRef } from "react";
import type { GeneratedSpriteEntry } from "../lib/generatedSprites";

export type PipelineStage =
  | { stage: "pipeline_started" }
  | {
      stage: "stage1_complete";
      payload: {
        object: string;
        mood: string;
        emoji: string;
        traits: string[];
        colors: string[];
      };
    }
  | {
      stage: "stage2_complete";
      payload: {
        paletteColors: string[];
        themeWords: string[];
        silhouetteHint: string;
        /** Curated from `DesignBrief` for map speech bubbles (adjectives, nouns, etc.). */
        peekWords?: string[];
      };
    }
  | { stage: "stage3a_started" }
  | { stage: "stage3a_complete"; payload: { stage3aUrl: string } }
  | { stage: "stage3b_started" }
  /** Map chamber rings (0–3): how many animation states you have approved, in any order. */
  | { stage: "stage3b_chambers_sync"; payload: { count: number } }
  | {
      stage: "sprite_sent";
      payload?: {
        entry: GeneratedSpriteEntry;
        stateUrls: Record<string, string>;
      };
    }
  /** Map page: run fullscreen particle splay before Add-to-Party overlay. */
  | { stage: "add_to_party_splay" }
  /** Map page: particle splay finished — SidePanel mounts Add-to-Party overlay. */
  | { stage: "add_to_party_splay_complete" }
  /**
   * Map page: remove handoff particle layer after Add-to-Party overlay finishes.
   * When `skipPipelinePersist` is true, the pipeline tab must not POST `/api/save-sprite`
   * (SidePanel already saves, or the user aborted — avoids duplicate `generated-sprites/` folders).
   */
  | {
      stage: "add_to_party_overlay_complete";
      payload?: { skipPipelinePersist?: boolean };
    };

/** Stable id for map ↔ pipeline tab sync (was `litebrite_pipeline_sync`). */
const CHANNEL_NAME = "block_party_pipeline_sync";

export function broadcast(event: PipelineStage) {
  const ch = new BroadcastChannel(CHANNEL_NAME);
  try {
    ch.postMessage(event);
  } finally {
    ch.close();
  }
}

export function useMapChannel(handler: (event: PipelineStage) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    ch.onmessage = (ev: MessageEvent<PipelineStage>) => {
      handlerRef.current(ev.data);
    };
    return () => {
      ch.onmessage = null;
      ch.close();
    };
  }, []);
}
