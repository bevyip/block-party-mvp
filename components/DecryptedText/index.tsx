import {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
  type ComponentProps,
} from "react";
import { motion } from "motion/react";
import {
  beginTranslationTypingSfx,
  endTranslationTypingSfx,
} from "../../utils/audio";

const styles = {
  wrapper: {
    display: "inline-block",
    whiteSpace: "pre-wrap",
  },
  srOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    border: 0,
  },
};

type MotionSpanProps = ComponentProps<typeof motion.span>;

export interface DecryptedTextOwnProps {
  text: string;
  speed?: number;
  maxIterations?: number;
  sequential?: boolean;
  revealDirection?: "start" | "end" | "center";
  useOriginalCharsOnly?: boolean;
  characters?: string;
  className?: string;
  parentClassName?: string;
  encryptedClassName?: string;
  animateOn?: "hover" | "click" | "view" | "inViewHover";
  clickMode?: "once" | "toggle";
  /** Fires once when sequential forward reveal finishes (all characters revealed). */
  onDecryptComplete?: () => void;
  /**
   * When true, loops `typing.mp3` only during active sequential forward decrypt
   * (map translation). Stops as soon as decrypt pauses or completes — not used
   * for color swatches (they do not use this component).
   */
  playTypingSound?: boolean;
}

export type DecryptedTextProps = DecryptedTextOwnProps &
  Omit<MotionSpanProps, keyof DecryptedTextOwnProps | "children">;

export default function DecryptedText({
  text,
  speed = 50,
  maxIterations = 10,
  sequential = false,
  revealDirection = "start",
  useOriginalCharsOnly = false,
  characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+",
  className = "",
  parentClassName = "",
  encryptedClassName = "",
  animateOn = "hover",
  clickMode = "once",
  onDecryptComplete,
  playTypingSound = false,
  ...props
}: DecryptedTextProps) {
  const onDecryptCompleteRef = useRef(onDecryptComplete);
  onDecryptCompleteRef.current = onDecryptComplete;

  const [displayText, setDisplayText] = useState(text);
  const [isAnimating, setIsAnimating] = useState(false);
  const [revealedIndices, setRevealedIndices] = useState<Set<number>>(
    new Set(),
  );
  const [isDecrypted, setIsDecrypted] = useState(animateOn !== "click");
  const [direction, setDirection] = useState<"forward" | "reverse">("forward");

  /** In-view decrypt runs once per mount / text reset; avoids stale `hasAnimated` closures and missed observers. */
  const viewDecryptConsumedRef = useRef(false);

  const containerRef = useRef<HTMLSpanElement | null>(null);
  const orderRef = useRef<number[]>([]);
  const pointerRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const availableChars = useMemo(() => {
    return useOriginalCharsOnly
      ? Array.from(new Set(text.split(""))).filter((char) => char !== " ")
      : characters.split("");
  }, [useOriginalCharsOnly, text, characters]);

  const shuffleText = useCallback(
    (originalText: string, currentRevealed: Set<number>) => {
      return originalText
        .split("")
        .map((char, i) => {
          if (char === " ") return " ";
          if (currentRevealed.has(i)) return originalText[i];
          return availableChars[
            Math.floor(Math.random() * availableChars.length)
          ]!;
        })
        .join("");
    },
    [availableChars],
  );

  const computeOrder = useCallback(
    (len: number) => {
      const order: number[] = [];
      if (len <= 0) return order;
      if (revealDirection === "start") {
        for (let i = 0; i < len; i++) order.push(i);
        return order;
      }
      if (revealDirection === "end") {
        for (let i = len - 1; i >= 0; i--) order.push(i);
        return order;
      }
      // center
      const middle = Math.floor(len / 2);
      let offset = 0;
      while (order.length < len) {
        if (offset % 2 === 0) {
          const idx = middle + offset / 2;
          if (idx >= 0 && idx < len) order.push(idx);
        } else {
          const idx = middle - Math.ceil(offset / 2);
          if (idx >= 0 && idx < len) order.push(idx);
        }
        offset++;
      }
      return order.slice(0, len);
    },
    [revealDirection],
  );

  const fillAllIndices = useCallback(() => {
    const s = new Set<number>();
    for (let i = 0; i < text.length; i++) s.add(i);
    return s;
  }, [text]);

  const removeRandomIndices = useCallback((set: Set<number>, count: number) => {
    const arr = Array.from(set);
    for (let i = 0; i < count && arr.length > 0; i++) {
      const idx = Math.floor(Math.random() * arr.length);
      arr.splice(idx, 1);
    }
    return new Set(arr);
  }, []);

  const encryptInstantly = useCallback(() => {
    const emptySet = new Set<number>();
    setRevealedIndices(emptySet);
    setDisplayText(shuffleText(text, emptySet));
    setIsDecrypted(false);
  }, [text, shuffleText]);

  const triggerDecrypt = useCallback(() => {
    if (sequential) {
      orderRef.current = computeOrder(text.length);
      pointerRef.current = 0;
      setRevealedIndices(new Set());
    } else {
      setRevealedIndices(new Set());
    }
    setDirection("forward");
    setIsAnimating(true);
  }, [sequential, computeOrder, text.length]);

  const triggerReverse = useCallback(() => {
    if (sequential) {
      // compute forward order then reverse it: we'll remove indices in that order
      orderRef.current = computeOrder(text.length).slice().reverse();
      pointerRef.current = 0;
      setRevealedIndices(fillAllIndices()); // start fully revealed
      setDisplayText(shuffleText(text, fillAllIndices()));
    } else {
      // non-seq: start from fully revealed as well
      setRevealedIndices(fillAllIndices());
      setDisplayText(shuffleText(text, fillAllIndices()));
    }
    setDirection("reverse");
    setIsAnimating(true);
  }, [sequential, computeOrder, fillAllIndices, shuffleText, text]);

  useEffect(() => {
    if (!isAnimating) return;

    let currentIteration = 0;

    const getNextIndex = (revealedSet: Set<number>) => {
      const textLength = text.length;
      switch (revealDirection) {
        case "start":
          return revealedSet.size;
        case "end":
          return textLength - 1 - revealedSet.size;
        case "center": {
          const middle = Math.floor(textLength / 2);
          const offset = Math.floor(revealedSet.size / 2);
          const nextIndex =
            revealedSet.size % 2 === 0 ? middle + offset : middle - offset - 1;

          if (nextIndex >= 0 && nextIndex < textLength && !revealedSet.has(nextIndex)) {
            return nextIndex;
          }

          for (let i = 0; i < textLength; i++) {
            if (!revealedSet.has(i)) return i;
          }
          return 0;
        }
        default:
          return revealedSet.size;
      }
    };

    intervalRef.current = setInterval(() => {
      setRevealedIndices((prevRevealed) => {
        if (sequential) {
          // Forward
          if (direction === "forward") {
            if (prevRevealed.size < text.length) {
              const nextIndex = getNextIndex(prevRevealed);
              const newRevealed = new Set(prevRevealed);
              newRevealed.add(nextIndex);
              setDisplayText(shuffleText(text, newRevealed));
              return newRevealed;
            } else {
              clearInterval(intervalRef.current!);
              setIsAnimating(false);
              setIsDecrypted(true);
              // Defer: this updater runs during React commit; parent handlers must not
              // setState synchronously here (e.g. MapOverlay → DetectionFlash handoff).
              const done = onDecryptCompleteRef.current;
              if (done) queueMicrotask(() => done());
              return prevRevealed;
            }
          }
          // Reverse
          if (direction === "reverse") {
            if (pointerRef.current < orderRef.current.length) {
              const idxToRemove = orderRef.current[pointerRef.current++]!;
              const newRevealed = new Set(prevRevealed);
              newRevealed.delete(idxToRemove);
              setDisplayText(shuffleText(text, newRevealed));
              if (newRevealed.size === 0) {
                clearInterval(intervalRef.current!);
                setIsAnimating(false);
                setIsDecrypted(false);
              }
              return newRevealed;
            } else {
              clearInterval(intervalRef.current!);
              setIsAnimating(false);
              setIsDecrypted(false);
              return prevRevealed;
            }
          }
        } else {
          // Non-Sequential
          if (direction === "forward") {
            setDisplayText(shuffleText(text, prevRevealed));
            currentIteration++;
            if (currentIteration >= maxIterations) {
              clearInterval(intervalRef.current!);
              setIsAnimating(false);
              setDisplayText(text);
              setIsDecrypted(true);
            }
            return prevRevealed;
          }

          // Non-Sequential Reverse
          if (direction === "reverse") {
            let currentSet = prevRevealed;
            if (currentSet.size === 0) {
              currentSet = fillAllIndices();
            }
            const removeCount = Math.max(
              1,
              Math.ceil(text.length / Math.max(1, maxIterations)),
            );
            const nextSet = removeRandomIndices(currentSet, removeCount);
            setDisplayText(shuffleText(text, nextSet));
            currentIteration++;
            if (nextSet.size === 0 || currentIteration >= maxIterations) {
              clearInterval(intervalRef.current!);
              setIsAnimating(false);
              setIsDecrypted(false);
              // ensure final scrambled state
              setDisplayText(shuffleText(text, new Set()));
              return new Set();
            }
            return nextSet;
          }
        }
        return prevRevealed;
      });
    }, speed);

    return () => clearInterval(intervalRef.current!);
  }, [
    isAnimating,
    text,
    speed,
    maxIterations,
    sequential,
    revealDirection,
    shuffleText,
    direction,
    fillAllIndices,
    removeRandomIndices,
    characters,
    useOriginalCharsOnly,
  ]);

  useEffect(() => {
    if (!playTypingSound) return;
    const active =
      isAnimating && sequential && direction === "forward";
    if (!active) return;
    beginTranslationTypingSfx();
    return () => {
      endTranslationTypingSfx();
    };
  }, [playTypingSound, isAnimating, sequential, direction]);

  /* Click Behaviour */
  const handleClick = () => {
    if (animateOn !== "click") return;

    if (clickMode === "once") {
      if (isDecrypted) return;
      setDirection("forward");
      triggerDecrypt();
    }

    if (clickMode === "toggle") {
      if (isDecrypted) {
        triggerReverse();
      } else {
        setDirection("forward");
        triggerDecrypt();
      }
    }
  };

  /* Hover Behaviour */
  const triggerHoverDecrypt = useCallback(() => {
    if (isAnimating) return;

    setRevealedIndices(new Set());
    setIsDecrypted(false);
    setDisplayText(text);
    setDirection("forward");
    setIsAnimating(true);
  }, [isAnimating, text]);

  const resetToPlainText = useCallback(() => {
    clearInterval(intervalRef.current!);
    setIsAnimating(false);
    setRevealedIndices(new Set());
    setDisplayText(text);
    setIsDecrypted(true);
    setDirection("forward");
  }, [text]);

  /**
   * Initialize display mode before paint. For `view`, start scrambled like `click`
   * so we never flash final copy if the observer is late.
   */
  useLayoutEffect(() => {
    viewDecryptConsumedRef.current = false;
    if (animateOn === "click") {
      encryptInstantly();
    } else if (animateOn === "view") {
      encryptInstantly();
    } else {
      setDisplayText(text);
      setIsDecrypted(true);
    }
    setRevealedIndices(new Set());
    setDirection("forward");
  }, [animateOn, text, encryptInstantly]);

  /**
   * `motion.span` may not attach `ref` until after the first commit; defer observe
   * with rAF and use threshold 0 so the line reliably intersects the viewport.
   */
  useLayoutEffect(() => {
    if (animateOn !== "view" && animateOn !== "inViewHover") return;

    let cancelled = false;
    let raf = 0;
    let observer: IntersectionObserver | null = null;
    let observedEl: Element | null = null;
    let attempts = 0;
    const maxAttempts = 120;

    const observerOptions: IntersectionObserverInit = {
      root: null,
      rootMargin: "0px",
      threshold: 0,
    };

    const observerCallback: IntersectionObserverCallback = (entries) => {
      entries.forEach((entry) => {
        if (
          !entry.isIntersecting ||
          viewDecryptConsumedRef.current ||
          cancelled
        ) {
          return;
        }
        viewDecryptConsumedRef.current = true;
        triggerDecrypt();
        observer?.disconnect();
        observer = null;
      });
    };

    const tryObserve = () => {
      if (cancelled) return;
      const el = containerRef.current;
      if (el) {
        observedEl = el;
        observer = new IntersectionObserver(observerCallback, observerOptions);
        observer.observe(el);
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        raf = requestAnimationFrame(tryObserve);
      }
    };

    raf = requestAnimationFrame(tryObserve);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (observer && observedEl) {
        observer.unobserve(observedEl);
        observer.disconnect();
      }
    };
  }, [animateOn, text, triggerDecrypt]);

  const animateProps =
    animateOn === "hover" || animateOn === "inViewHover"
      ? {
          onMouseEnter: triggerHoverDecrypt,
          onMouseLeave: resetToPlainText,
        }
      : animateOn === "click"
        ? {
            onClick: handleClick,
          }
        : {};

  return (
    <motion.span
      className={parentClassName}
      ref={containerRef}
      style={styles.wrapper}
      {...animateProps}
      {...props}
    >
      <span style={styles.srOnly}>{displayText}</span>

      <span aria-hidden="true">
        {displayText.split("").map((char, index) => {
          const isRevealedOrDone =
            revealedIndices.has(index) || (!isAnimating && isDecrypted);

          return (
            <span
              key={index}
              className={isRevealedOrDone ? className : encryptedClassName}
            >
              {char}
            </span>
          );
        })}
      </span>
    </motion.span>
  );
}
