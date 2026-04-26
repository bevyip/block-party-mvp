import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CARD_URLS } from "virtual:cards-gallery";
import SpritesStarfield from "./SpritesStarfield";

const COLS = 10;
const CELL = 168;
const GAP = 14;
/** Absolute floor for zoom-out (only used when grid is smaller than viewport). */
const SCALE_ABS_MIN = 0.22;
const MAX_SCALE = 4;
const WHEEL_ZOOM_PIXEL_FACTOR = 0.002;
/** At max zoom-out, visible span is at most this fraction of content (rest needs pan). */
const MAX_VISIBLE_FRAC = 0.75;
/** Initial view: aim for roughly this many columns worth of width on screen. */
const INITIAL_VISIBLE_COLS = 2.55;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function clampPan(
  tx: number,
  ty: number,
  scale: number,
  vw: number,
  vh: number,
  contentW: number,
  contentH: number,
): { tx: number; ty: number } {
  const sw = contentW * scale;
  const sh = contentH * scale;
  let minTx: number;
  let maxTx: number;
  let minTy: number;
  let maxTy: number;
  if (sw <= vw) {
    minTx = maxTx = (vw - sw) / 2;
  } else {
    maxTx = 0;
    minTx = vw - sw;
  }
  if (sh <= vh) {
    minTy = maxTy = (vh - sh) / 2;
  } else {
    maxTy = 0;
    minTy = vh - sh;
  }
  return {
    tx: clamp(tx, minTx, maxTx),
    ty: clamp(ty, minTy, maxTy),
  };
}

function wheelZoomModifier(e: WheelEvent): boolean {
  return (
    e.ctrlKey ||
    e.metaKey ||
    (typeof e.getModifierState === "function" &&
      (e.getModifierState("Control") || e.getModifierState("Meta")))
  );
}

/** Normalize deltaY to pixel-like units so mouse wheels (DOM_DELTA_LINE) zoom enough. */
function normalizeWheelDeltaY(e: WheelEvent): number {
  let d = e.deltaY;
  if (e.deltaMode === 1) d *= 24;
  else if (e.deltaMode === 2) d *= 640;
  return d;
}

function pointInClientRect(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    const seg = u.pathname.split("/").filter(Boolean);
    return seg[seg.length - 1] ?? "card.png";
  } catch {
    const seg = url.split("/").filter(Boolean);
    return seg[seg.length - 1] ?? "card.png";
  }
}

/** Stable foil focal point + hue wheel angle per URL (static, no motion). */
function thumbHolographicCssVars(src: string): React.CSSProperties {
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u0 = (h >>> 0) / 2 ** 32;
  const h2 = Math.imul(h ^ (h >>> 11), 1597334677) >>> 0;
  const u2 = h2 / 2 ** 32;
  const hx = 26 + u0 * 48;
  const hy = 22 + u2 * 52;
  const spin = -52 + ((h >>> 0) % 7200) / 7200 * 104;
  return {
    ["--hx" as string]: `${hx.toFixed(1)}%`,
    ["--hy" as string]: `${hy.toFixed(1)}%`,
    ["--spin" as string]: `${spin.toFixed(1)}deg`,
  } as React.CSSProperties;
}

function SpritesGridThumb({ src }: { src: string }) {
  const holo = thumbHolographicCssVars(src);
  return (
    <div
      className="relative inline-block max-h-full max-w-full overflow-hidden"
      style={{
        borderRadius: 2,
        isolation: "isolate",
        ...holo,
      }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="relative z-0 box-border block max-h-full max-w-full select-none object-contain"
        onDragStart={(e) => e.preventDefault()}
        style={{
          borderRadius: 2,
          width: "auto",
          height: "auto",
          maxWidth: CELL,
          maxHeight: CELL,
          WebkitUserDrag: "none",
          userSelect: "none",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          borderRadius: 2,
          mixBlendMode: "soft-light",
          opacity: 0.4,
          background: `conic-gradient(from var(--spin) at var(--hx) var(--hy),
            hsla(268, 74%, 57%, 0.38),
            hsla(198, 70%, 55%, 0.34),
            hsla(155, 64%, 53%, 0.3),
            hsla(48, 70%, 55%, 0.34),
            hsla(312, 68%, 55%, 0.36),
            hsla(268, 74%, 57%, 0.38))`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[11]"
        style={{
          borderRadius: 2,
          mixBlendMode: "screen",
          opacity: 0.3,
          background: `radial-gradient(ellipse 95% 72% at var(--hx) var(--hy),
            rgba(255,255,255,0.5) 0%,
            rgba(220,235,255,0.22) 28%,
            transparent 58%)`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[12]"
        style={{
          borderRadius: 2,
          mixBlendMode: "overlay",
          opacity: 0.18,
          background: `repeating-linear-gradient(
            118deg,
            transparent 0px,
            transparent 2px,
            rgba(255,255,255,0.04) 2px,
            rgba(255,255,255,0.07) 3px,
            transparent 3px,
            transparent 7px
          )`,
        }}
      />
    </div>
  );
}

const OVERLAY_MAX_TILT = 15;

function OverlayPreview({
  url,
  downloadName,
}: {
  url: string;
  downloadName: string;
}) {
  const tiltRootRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const [shine, setShine] = useState({ px: 50, py: 50 });
  const [dragging, setDragging] = useState(false);
  const [supportsHoverTilt, setSupportsHoverTilt] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  });
  const pointerDown = useRef(false);

  const resetTilt = useCallback(() => {
    pointerDown.current = false;
    setDragging(false);
    setTilt({ rx: 0, ry: 0 });
    setShine({ px: 50, py: 50 });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => {
      setSupportsHoverTilt(mq.matches);
      if (mq.matches) resetTilt();
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [resetTilt]);

  const applyPointer = useCallback((clientX: number, clientY: number) => {
    const el = tiltRootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const nx = (clientX - cx) / (r.width / 2);
    const ny = (clientY - cy) / (r.height / 2);
    setTilt({
      ry: clamp(nx * OVERLAY_MAX_TILT, -OVERLAY_MAX_TILT, OVERLAY_MAX_TILT),
      rx: clamp(-ny * OVERLAY_MAX_TILT, -OVERLAY_MAX_TILT, OVERLAY_MAX_TILT),
    });
    setShine({
      px: clamp(((clientX - r.left) / r.width) * 100, 0, 100),
      py: clamp(((clientY - r.top) / r.height) * 100, 0, 100),
    });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      if (supportsHoverTilt) {
        applyPointer(e.clientX, e.clientY);
        return;
      }
      if (e.button !== 0) return;
      pointerDown.current = true;
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      applyPointer(e.clientX, e.clientY);
    },
    [applyPointer, supportsHoverTilt],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!supportsHoverTilt && !pointerDown.current) return;
      applyPointer(e.clientX, e.clientY);
    },
    [applyPointer, supportsHoverTilt],
  );

  const endPointer = useCallback((e: React.PointerEvent) => {
    if (supportsHoverTilt) return;
    if (!pointerDown.current) return;
    resetTilt();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, [resetTilt, supportsHoverTilt]);

  const spinDeg = tilt.ry * 2.2 + tilt.rx * 1.4;

  return (
    <>
      <div
        ref={tiltRootRef}
        className="inline-block max-w-full cursor-grab active:cursor-grabbing"
        style={{ perspective: 1000, touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={(e) => {
          if (supportsHoverTilt) {
            resetTilt();
            return;
          }
          if (
            pointerDown.current &&
            !e.currentTarget.hasPointerCapture(e.pointerId)
          ) {
            resetTilt();
          }
        }}
      >
        <div
          style={{
            transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
            transformStyle: "preserve-3d",
            transition: dragging
              ? "none"
              : "transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)",
            willChange: dragging ? "transform" : undefined,
          }}
        >
          <div
            className="relative overflow-hidden"
            style={
              {
                borderRadius: 6,
                isolation: "isolate",
                ["--hx" as string]: `${shine.px}%`,
                ["--hy" as string]: `${shine.py}%`,
                ["--spin" as string]: `${spinDeg}deg`,
              } as React.CSSProperties
            }
          >
            <img
              src={url}
              alt=""
              className="relative z-0 block max-h-[min(72vh,800px)] max-w-full object-contain"
              style={{ borderRadius: 6 }}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
            />
            {/* Rainbow foil — soft-light reads on photos better than overlay */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10"
              style={{
                borderRadius: 6,
                mixBlendMode: "soft-light",
                opacity: 0.52,
                background: `conic-gradient(from var(--spin) at var(--hx) var(--hy),
                    hsla(268, 74%, 57%, 0.38),
                    hsla(198, 70%, 55%, 0.34),
                    hsla(155, 64%, 53%, 0.3),
                    hsla(48, 70%, 55%, 0.34),
                    hsla(312, 68%, 55%, 0.36),
                    hsla(268, 74%, 57%, 0.38))`,
              }}
            />
            {/* Moving highlight — screen lifts without a hard diagonal line */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[11]"
              style={{
                borderRadius: 6,
                mixBlendMode: "screen",
                opacity: 0.36,
                background: `
                  radial-gradient(ellipse 95% 72% at var(--hx) var(--hy),
                    rgba(255,255,255,0.55) 0%,
                    rgba(220,235,255,0.28) 28%,
                    transparent 58%)`,
              }}
            />
          </div>
        </div>
      </div>
      <a
        className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 hover:border-zinc-600 hover:bg-zinc-800"
        href={url}
        download={downloadName}
        onPointerDown={(e) => e.stopPropagation()}
      >
        Save Image
      </a>
    </>
  );
}

export function SpritesPage() {
  const [cardUrls, setCardUrls] = useState<string[]>(() => [...CARD_URLS]);
  const urls = cardUrls;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/cards-gallery", { cache: "no-store" });
        const ct = r.headers.get("content-type") ?? "";
        if (!r.ok || !ct.includes("application/json")) return;
        const data: unknown = await r.json();
        if (!data || typeof data !== "object") return;
        const raw = (data as { urls?: unknown }).urls;
        if (!Array.isArray(raw) || !raw.every((u) => typeof u === "string")) {
          return;
        }
        const next = raw as string[];
        if (!cancelled) {
          /** Never replace a non-empty baked-in list with an empty API (e.g. HTML mis-route). */
          setCardUrls((prev) => (next.length > 0 ? next : prev));
        }
      } catch {
        /* keep virtual:baked-in list when API is unavailable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const rows = Math.max(1, Math.ceil(urls.length / COLS));
  const contentW = COLS * CELL + (COLS - 1) * GAP;
  const contentH = rows * CELL + (rows - 1) * GAP;
  /** Same as space between cards: inset grid from viewport top/bottom (and left/right). */
  const EDGE_INSET = GAP;
  const canvasW = contentW + 2 * EDGE_INSET;
  const canvasH = contentH + 2 * EDGE_INSET;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [vw, setVw] = useState(
    typeof window !== "undefined" ? window.innerWidth : 800,
  );
  const [vh, setVh] = useState(
    typeof window !== "undefined" ? window.innerHeight : 600,
  );

  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);

  const colPitch = CELL + GAP;
  const minScale = useMemo(() => {
    if (urls.length === 0) return SCALE_ABS_MIN;
    const sx = vw / (MAX_VISIBLE_FRAC * canvasW);
    const sy = vh / (MAX_VISIBLE_FRAC * canvasH);
    return Math.max(SCALE_ABS_MIN, sx, sy);
  }, [canvasH, canvasW, urls.length, vh, vw]);

  /** Lower zoom bound used for gestures (never above `MAX_SCALE`). */
  const zoomMin = Math.min(minScale, MAX_SCALE);

  const initialZoomApplied = useRef(false);

  const txRef = useRef(tx);
  const tyRef = useRef(ty);
  const scaleRef = useRef(scale);
  txRef.current = tx;
  tyRef.current = ty;
  scaleRef.current = scale;

  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);

  const pinchRef = useRef<{
    d0: number;
    s0: number;
    tx0: number;
    ty0: number;
    wx: number;
    wy: number;
  } | null>(null);

  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const overlayUrlRef = useRef<string | null>(null);
  overlayUrlRef.current = overlayUrl;
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpHovered, setHelpHovered] = useState(false);
  const helpWrapRef = useRef<HTMLDivElement | null>(null);
  const helpLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHelpLeaveTimer = useCallback(() => {
    if (helpLeaveTimerRef.current != null) {
      window.clearTimeout(helpLeaveTimerRef.current);
      helpLeaveTimerRef.current = null;
    }
  }, []);

  const onHelpMouseEnter = useCallback(() => {
    clearHelpLeaveTimer();
    setHelpHovered(true);
  }, [clearHelpLeaveTimer]);

  const onHelpMouseLeave = useCallback(() => {
    clearHelpLeaveTimer();
    helpLeaveTimerRef.current = window.setTimeout(() => {
      if (!helpOpen) setHelpHovered(false);
    }, 200);
  }, [clearHelpLeaveTimer, helpOpen]);

  useEffect(() => {
    if (!helpOpen) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const el = helpWrapRef.current;
      if (el && !el.contains(e.target as Node)) setHelpOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onDocPointerDown, true);
  }, [helpOpen]);

  useEffect(() => {
    return () => clearHelpLeaveTimer();
  }, [clearHelpLeaveTimer]);

  useEffect(() => {
    if (helpOpen) clearHelpLeaveTimer();
  }, [helpOpen, clearHelpLeaveTimer]);

  const measure = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setVw(r.width);
    setVh(r.height);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, canvasH, canvasW, contentH, contentW, urls.length]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || urls.length === 0 || initialZoomApplied.current) return;
    const r = el.getBoundingClientRect();
    const cw = r.width;
    const ch = r.height;
    if (cw < 48 || ch < 48) return;

    const sMin = Math.max(
      SCALE_ABS_MIN,
      cw / (MAX_VISIBLE_FRAC * canvasW),
      ch / (MAX_VISIBLE_FRAC * canvasH),
    );
    const zMin = Math.min(sMin, MAX_SCALE);
    const sInit = Math.min(
      MAX_SCALE,
      Math.max(
        zMin,
        sMin * 1.12,
        cw / (INITIAL_VISIBLE_COLS * colPitch),
        ch / (INITIAL_VISIBLE_COLS * colPitch),
      ),
    );
    const c = clampPan(
      cw / 2 - (canvasW / 2) * sInit,
      ch / 2 - (canvasH / 2) * sInit,
      sInit,
      cw,
      ch,
      canvasW,
      canvasH,
    );
    setVw(cw);
    setVh(ch);
    setScale(sInit);
    setTx(c.tx);
    setTy(c.ty);
    initialZoomApplied.current = true;
  }, [canvasH, canvasW, colPitch, urls.length]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  useEffect(() => {
    if (urls.length === 0) return;
    if (scale < zoomMin) {
      const c = clampPan(tx, ty, zoomMin, vw, vh, canvasW, canvasH);
      setScale(zoomMin);
      setTx(c.tx);
      setTy(c.ty);
      return;
    }
    const next = clampPan(tx, ty, scale, vw, vh, canvasW, canvasH);
    if (next.tx !== tx || next.ty !== ty) {
      setTx(next.tx);
      setTy(next.ty);
    }
  }, [canvasH, canvasW, scale, tx, ty, urls.length, vw, vh, zoomMin]);

  const applyPan = useCallback(
    (nx: number, ny: number) => {
      const c = clampPan(nx, ny, scaleRef.current, vw, vh, canvasW, canvasH);
      setTx(c.tx);
      setTy(c.ty);
    },
    [canvasH, canvasW, vw, vh],
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || urls.length === 0) return;

    const onWheel = (e: WheelEvent) => {
      if (overlayUrlRef.current) return;

      const rect = el.getBoundingClientRect();
      const { clientX, clientY } = e;
      if (!pointInClientRect(clientX, clientY, rect)) return;

      const help = helpWrapRef.current;
      if (
        help &&
        pointInClientRect(clientX, clientY, help.getBoundingClientRect())
      )
        return;

      const tipEl = document.getElementById(
        "sprites-canvas-help-tip",
      ) as HTMLElement | null;
      if (
        tipEl &&
        window.getComputedStyle(tipEl).pointerEvents !== "none" &&
        pointInClientRect(clientX, clientY, tipEl.getBoundingClientRect())
      )
        return;

      const localX = clientX - rect.left;
      const localY = clientY - rect.top;

      if (wheelZoomModifier(e)) {
        e.preventDefault();
        e.stopPropagation();
        const s0 = scaleRef.current;
        const t0x = txRef.current;
        const t0y = tyRef.current;
        const delta = -normalizeWheelDeltaY(e);
        const factor = Math.exp(delta * WHEEL_ZOOM_PIXEL_FACTOR);
        const s1 = clamp(s0 * factor, zoomMin, MAX_SCALE);
        if (s1 === s0) return;
        const wx = (localX - t0x) / s0;
        const wy = (localY - t0y) / s0;
        const t1x = localX - wx * s1;
        const t1y = localY - wy * s1;
        const c = clampPan(t1x, t1y, s1, vw, vh, canvasW, canvasH);
        setScale(s1);
        setTx(c.tx);
        setTy(c.ty);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      applyPan(txRef.current, tyRef.current - normalizeWheelDeltaY(e));
    };

    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [applyPan, canvasH, canvasW, urls.length, vw, vh, zoomMin]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (overlayUrl) return;
      if (e.button !== 0) return;
      if (pinchRef.current) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        lastX: e.clientX,
        lastY: e.clientY,
      };
    },
    [overlayUrl],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      applyPan(txRef.current + dx, tyRef.current + dy);
    },
    [applyPan],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) {
      dragRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || urls.length === 0) return;

    const onTouchStart = (ev: TouchEvent) => {
      if (overlayUrl) return;
      if (ev.touches.length === 2) {
        ev.preventDefault();
        dragRef.current = null;
        const a = ev.touches[0]!;
        const b = ev.touches[1]!;
        const d0 = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        if (d0 < 8) return;
        const rect = el.getBoundingClientRect();
        const cx = (a.clientX + b.clientX) / 2 - rect.left;
        const cy = (a.clientY + b.clientY) / 2 - rect.top;
        const s0 = scaleRef.current;
        const tx0 = txRef.current;
        const ty0 = tyRef.current;
        const wx = (cx - tx0) / s0;
        const wy = (cy - ty0) / s0;
        pinchRef.current = { d0, s0, tx0, ty0, wx, wy };
      }
    };

    const onTouchMove = (ev: TouchEvent) => {
      const p = pinchRef.current;
      if (!p || ev.touches.length < 2) return;
      ev.preventDefault();
      const a = ev.touches[0]!;
      const b = ev.touches[1]!;
      const d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      if (d < 8) return;
      const rect = el.getBoundingClientRect();
      const cx = (a.clientX + b.clientX) / 2 - rect.left;
      const cy = (a.clientY + b.clientY) / 2 - rect.top;
      const s1 = clamp(p.s0 * (d / p.d0), zoomMin, MAX_SCALE);
      const tx1 = cx - p.wx * s1;
      const ty1 = cy - p.wy * s1;
      const c = clampPan(tx1, ty1, s1, vw, vh, canvasW, canvasH);
      setScale(s1);
      setTx(c.tx);
      setTy(c.ty);
    };

    const onTouchEnd = (ev: TouchEvent) => {
      if (ev.touches.length < 2) pinchRef.current = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [canvasH, canvasW, overlayUrl, urls.length, vw, vh, zoomMin]);

  const gridTemplate = useMemo(
    () => ({
      width: contentW,
      height: contentH,
      display: "grid" as const,
      gridTemplateColumns: `repeat(${COLS}, ${CELL}px)`,
      gridAutoRows: `${CELL}px`,
      gap: GAP,
    }),
    [contentH, contentW],
  );

  const showHelpTip = helpOpen || helpHovered;

  return (
    <div
      className="fixed inset-0 bg-[#0a0a0a] select-none"
      style={{ WebkitUserSelect: "none", userSelect: "none" }}
    >
      <SpritesStarfield />
      <div
        ref={viewportRef}
        className="relative z-[1] h-full w-full overflow-hidden"
        style={{ touchAction: "none", cursor: "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {urls.length === 0 ? null : (
          <div
            className="will-change-transform box-border"
            style={{
              transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
              transformOrigin: "0 0",
              width: canvasW,
              height: canvasH,
              padding: EDGE_INSET,
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            <div style={gridTemplate}>
              {urls.map((src) => (
                <button
                  key={src}
                  type="button"
                  className="m-0 box-border inline-flex max-h-full max-w-full cursor-pointer appearance-none items-center justify-center border-0 bg-transparent p-0 outline-none"
                  style={{
                    WebkitTapHighlightColor: "transparent",
                    justifySelf: "center",
                    alignSelf: "center",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDragStart={(e) => e.preventDefault()}
                  onClick={() => setOverlayUrl(src)}
                  aria-label="Open card"
                >
                  <SpritesGridThumb src={src} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div
        ref={helpWrapRef}
        className="pointer-events-auto absolute right-3 top-3 z-30 font-google-sans-code"
        onMouseEnter={onHelpMouseEnter}
        onMouseLeave={onHelpMouseLeave}
      >
        <button
          type="button"
          className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/80 text-sm font-medium text-neutral-200 shadow-md transition-colors hover:bg-neutral-800 hover:text-white"
          aria-expanded={helpOpen}
          aria-label="Canvas shortcuts"
          aria-describedby="sprites-canvas-help-tip"
          onClick={(e) => {
            e.stopPropagation();
            setHelpOpen((o) => !o);
          }}
        >
          ?
        </button>
        <div
          id="sprites-canvas-help-tip"
          role="tooltip"
          className={`absolute right-0 top-full z-50 mt-2 w-max max-w-[min(100vw-2rem,28rem)] rounded-md border border-neutral-700 bg-neutral-900/95 px-3 py-2 text-left text-[11px] leading-tight text-neutral-200 shadow-lg transition-opacity duration-150 ${
            showHelpTip
              ? "visible opacity-100 pointer-events-auto"
              : "invisible pointer-events-none opacity-0"
          }`}
        >
          {/*
            xl (1280px+): wide screens — show PC + iOS split.
            Below xl: phone / tablet — touch-only (media query, not UA sniffing).
          */}
          <div className="hidden flex-col gap-0.5 xl:flex">
            <div className="whitespace-nowrap">Zoom: Ctrl/ ⌘ + scroll</div>
            <div className="whitespace-nowrap">Select card: click</div>
            <div className="whitespace-nowrap">Pan: drag or scroll wheel</div>
          </div>
          <div className="flex flex-col gap-0.5 xl:hidden">
            <div className="whitespace-nowrap">Zoom: pinch</div>
            <div className="whitespace-nowrap">Select card: tap</div>
            <div className="whitespace-nowrap">Pan: drag</div>
          </div>
        </div>
      </div>

      {overlayUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Card preview"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setOverlayUrl(null);
          }}
        >
          <div
            className="relative flex max-h-[min(92vh,920px)] max-w-[min(92vw,920px)] flex-col items-center gap-6 px-6 pb-2 pt-2"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <OverlayPreview
              url={overlayUrl}
              downloadName={filenameFromUrl(overlayUrl)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
