// Theme switch reveal (presentation only): the new theme opens as a circle from the tapped
// control, using the View Transitions API. Browsers without it, and reduced-motion users, get
// the plain instant switch. The matching CSS (default cross-fade off) is in globals.css.

export type RevealPoint = Readonly<{ x: number; y: number }>;
export type RevealViewport = Readonly<{ width: number; height: number }>;

/** Radius that reaches the farthest viewport corner from `origin`. */
export function revealRadius(origin: RevealPoint, viewport: RevealViewport): number {
  return Math.hypot(Math.max(origin.x, viewport.width - origin.x), Math.max(origin.y, viewport.height - origin.y));
}

type RevealDocument = {
  startViewTransition?: (update: () => void) => { ready: Promise<unknown> };
  documentElement: { animate: (keyframes: { clipPath: string[] }, options: KeyframeAnimationOptions) => unknown };
};

export const THEME_REVEAL_MS = 620;

/**
 * Runs `apply` (which must switch the theme synchronously). Returns "animated" when the circular
 * reveal was started, "instant" when the theme was simply switched.
 */
export function runThemeReveal({
  apply,
  origin,
  viewport,
  doc,
  reduceMotion,
}: {
  apply: () => void;
  origin: RevealPoint;
  viewport: RevealViewport;
  doc: RevealDocument | null;
  reduceMotion: boolean;
}): "instant" | "animated" {
  if (reduceMotion || !doc || typeof doc.startViewTransition !== "function") {
    apply();
    return "instant";
  }

  let applied = false;
  const update = () => {
    applied = true;
    apply();
  };

  try {
    const transition = doc.startViewTransition(update);
    const radius = revealRadius(origin, viewport);
    const at = `${origin.x}px ${origin.y}px`;
    transition.ready
      .then(() => {
        doc.documentElement.animate(
          { clipPath: [`circle(0px at ${at})`, `circle(${radius}px at ${at})`] },
          { duration: THEME_REVEAL_MS, easing: "cubic-bezier(0.23, 1, 0.32, 1)", pseudoElement: "::view-transition-new(root)" },
        );
      })
      .catch(() => {
        // The transition was skipped (e.g. the tab went to the background); the theme is already applied.
      });
    return "animated";
  } catch {
    if (!applied) apply();
    return "instant";
  }
}
