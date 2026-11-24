/* A tick as a fingertip meets a card.

   Android has the Vibration API, so a card is a 12ms pulse. iOS has never
   shipped it, and since 26.5 a click fired from script no longer ticks
   either. What still ticks is WebKit's own tracking of a switch the finger
   is already on: the touch has to start on a real `<input switch>`, and
   from then on WebKit compares the finger with that switch's box. Sliding
   the box past the finger makes the next movement of the finger flip the
   thumb, and the flip is the tick. The switch is invisible and lives on the
   card; nothing here is a vibration motor we drive ourselves.

   A MacBook trackpad has no vibration motor the page can run. Safari plays
   its own level-change tick — the same one a system switch uses — only while
   a pressed pointer is tracking a real `<input switch>`. A hover never
   starts that tracking, so the tick is the press-and-slide across the cards.
   Chrome on the Mac never reaches the motor. */

const ARM_MS = 260;
const MOVE_GAP = 2;
const SLOP = 12;
const PARK = 10_000;

export function isContact(pointerType: string): boolean {
  return pointerType === "touch" || pointerType === "pen";
}

/* Devices whose only haptic is a native switch: iPhone, and Safari on a
   Mac, where that switch tick is the trackpad. Chrome has vibrate() and, on
   a Mac, no motor behind it, so it is not one of these. */
export function wantsSwitch(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (typeof navigator.vibrate === "function") return false;
  if ("switch" in HTMLInputElement.prototype) return true;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  return navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform);
}

export function subscribeSwitch(onChange: () => void): () => void {
  const media = [
    window.matchMedia("(prefers-reduced-motion: reduce)"),
    window.matchMedia("(any-pointer: coarse)"),
  ];
  for (const query of media) query.addEventListener("change", onChange);
  return () => {
    for (const query of media) query.removeEventListener("change", onChange);
  };
}

export function cardAt(x: number, y: number): { id: number; el: HTMLElement } | null {
  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (!(node instanceof Element)) continue;
    const blade = node.closest<HTMLElement>("[data-blade]");
    if (!blade) continue;
    const id = Number(blade.dataset.blade);
    if (Number.isNaN(id)) continue;
    return { id, el: blade };
  }
  return null;
}

type Ticker = {
  on: boolean;
  armedAt: number;
  pending: boolean;
  movesSince: number;
  parked: boolean;
};

/* LTR: the thumb sits on the left while the switch is off. `flip` puts the
   box on the thumb's side so the finger is past the change point. */
function placement(on: boolean, flip: boolean): string {
  const thumbLeft = !on;
  const left = flip ? thumbLeft : !thumbLeft;
  return `translate3d(${left ? -PARK : PARK}px, 0, 0)`;
}

function paint(input: HTMLInputElement, transform: string) {
  input.style.transform = transform;
  /* WebKit reads the box in the same turn, after this listener returns.
     Without a flush it still sees the box from the last frame and the
     flip — the tick — waits for a movement that never gets counted. */
  input.getBoundingClientRect();
}

function release(ticker: Ticker, now: number): string | null {
  if (!ticker.pending || now < ticker.armedAt || ticker.movesSince < MOVE_GAP) return null;
  ticker.pending = false;
  ticker.movesSince = 0;
  ticker.parked = true;
  const transform = placement(ticker.on, true);
  ticker.on = !ticker.on;
  return transform;
}

/* One finger-move. A tick requested earlier is let go once tracking has
   armed; otherwise the box is parked off to the side it already agrees
   with, so a resting finger doesn't flip it by drifting across the middle. */
function follow(ticker: Ticker, now: number): string | null {
  ticker.movesSince += 1;
  const step = release(ticker, now);
  if (step || ticker.parked || now < ticker.armedAt) return step;
  ticker.parked = true;
  return placement(ticker.on, false);
}

export interface Haptics {
  /** The card the finger is on, or null once it has lifted. */
  card: number | null;
  /** True once the finger has travelled — a drag, not a tap. */
  moved: boolean;
  down(input: HTMLInputElement | null, x: number, y: number, armMs?: number): void;
  meet(kind: "touch" | "hover"): void;
  /** Swallow the click that ends a drag across the open fan. */
  consumeClick(open: boolean): "tap" | "drag";
  stop(): void;
  focus(hit: { id: number; el: HTMLElement } | null): void;
}

export function createHaptics(onMove: { readonly current: (event: PointerEvent) => void }): Haptics {
  let input: HTMLInputElement | null = null;
  let ticker: Ticker | null = null;
  let hot: HTMLElement | null = null;
  let originX = 0;
  let originY = 0;
  let tracking = false;
  let unlisten: (() => void) | null = null;
  /* The switch and the deck both see the click that ends a touch. The first
     of them decides tap-or-drag; the second has to agree. */
  let verdict: "tap" | "drag" | null = null;
  /* Set when the finger travelled. A drag's click arrives after pointerup,
     and some browsers cancel the pointer first — `moved` would already be
     gone, and the fan would shut. Cleared once that click has had its turn. */
  let pendingDrag = false;
  const haptics: Haptics = {
    card: null,
    moved: false,

    down(next, x, y, armMs = ARM_MS) {
      if (input) input.style.transform = "";
      input = next;
      originX = x;
      originY = y;
      haptics.moved = false;
      haptics.card = null;
      pendingDrag = false;
      verdict = null;
      tracking = true;
      ticker = next
        ? { on: next.checked, armedAt: performance.now() + armMs, pending: false, movesSince: Number.POSITIVE_INFINITY, parked: false }
        : null;
      unlisten?.();
      const move = (event: PointerEvent) => {
        /* A trackpad drag is a mouse with the button held. Safari only ticks
           a switch while that press is still down. */
        const gliding = (event.buttons & 1) === 1 && !isContact(event.pointerType);
        if (!tracking || (!isContact(event.pointerType) && !gliding)) return;
        const dx = event.clientX - originX;
        const dy = event.clientY - originY;
        if (dx * dx + dy * dy > SLOP * SLOP) haptics.moved = true;
        if (ticker && input) {
          const step = follow(ticker, performance.now());
          if (step) paint(input, step);
        }
        onMove.current(event);
      };
      const up = (event: PointerEvent) => {
        if (!isContact(event.pointerType) && event.pointerType !== "mouse") return;
        const dragged = haptics.moved;
        haptics.stop();
        if (!dragged) return;
        pendingDrag = true;
        /* Click is dispatched in this same turn, before microtasks. If none
           comes, drop the drag so the next mouse click still toggles. */
        queueMicrotask(() => {
          pendingDrag = false;
        });
      };
      window.addEventListener("pointermove", move, { capture: true, passive: true });
      window.addEventListener("pointerup", up, { capture: true });
      window.addEventListener("pointercancel", up, { capture: true });
      unlisten = () => {
        window.removeEventListener("pointermove", move, { capture: true });
        window.removeEventListener("pointerup", up, { capture: true });
        window.removeEventListener("pointercancel", up, { capture: true });
        unlisten = null;
      };
    },

    meet(kind) {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      /* iOS: ask the tracked switch to flip on the finger's next movement.
         Anywhere else: a short pulse, if the device has one. */
      if (ticker) {
        ticker.pending = true;
        const step = release(ticker, performance.now());
        if (step && input) paint(input, step);
        return;
      }
      const nav = navigator as Navigator & { playHaptics?: (effect: string) => void };
      if (typeof nav.playHaptics === "function") {
        try {
          nav.playHaptics(kind === "hover" ? "hint" : "tick");
        } catch {
          /* the device declined */
        }
        return;
      }
      if (typeof navigator.vibrate !== "function") return;
      /* A mouse entering a card is not a user gesture, and Chrome logs an
         intervention if vibrate() is called from one. */
      if (kind === "hover" && !navigator.userActivation?.isActive) return;
      try {
        navigator.vibrate(12);
      } catch {
        /* no motor, or the gesture had already expired */
      }
    },

    consumeClick(open) {
      if (!verdict) {
        verdict = open && (haptics.moved || pendingDrag) ? "drag" : "tap";
        haptics.moved = false;
        pendingDrag = false;
        queueMicrotask(() => {
          verdict = null;
        });
      }
      return verdict;
    },

    focus(hit) {
      const el = hit?.el ?? null;
      if (hot && hot !== el) delete hot.dataset.hot;
      if (el && el !== hot) el.dataset.hot = "true";
      hot = el;
      haptics.card = hit?.id ?? null;
    },

    stop() {
      tracking = false;
      unlisten?.();
      if (hot) delete hot.dataset.hot;
      hot = null;
      haptics.card = null;
      if (input) input.style.transform = "";
      input = null;
      ticker = null;
    },
  };
  return haptics;
}
