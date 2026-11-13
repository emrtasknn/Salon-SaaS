import { describe, expect, it, vi } from "vitest";
import { revealRadius, runThemeReveal } from "./theme-reveal";

describe("revealRadius", () => {
  it("reaches the farthest corner from the tap point", () => {
    expect(revealRadius({ x: 0, y: 0 }, { width: 300, height: 400 })).toBe(500);
    expect(revealRadius({ x: 300, y: 400 }, { width: 300, height: 400 })).toBe(500);
    expect(revealRadius({ x: 150, y: 200 }, { width: 300, height: 400 })).toBe(250);
  });
});

describe("runThemeReveal", () => {
  const origin = { x: 350, y: 60 };
  const viewport = { width: 390, height: 844 };

  it("switches at once when the browser has no view transitions", () => {
    const apply = vi.fn();
    const doc = { documentElement: { animate: vi.fn() } };
    expect(runThemeReveal({ apply, origin, viewport, doc, reduceMotion: false })).toBe("instant");
    expect(apply).toHaveBeenCalledTimes(1);
    expect(doc.documentElement.animate).not.toHaveBeenCalled();
  });

  it("switches at once when reduced motion is requested", () => {
    const apply = vi.fn();
    const startViewTransition = vi.fn();
    const doc = { startViewTransition, documentElement: { animate: vi.fn() } };
    expect(runThemeReveal({ apply, origin, viewport, doc, reduceMotion: true })).toBe("instant");
    expect(apply).toHaveBeenCalledTimes(1);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("opens the new theme as a circle from the tap point", async () => {
    const apply = vi.fn();
    const animate = vi.fn();
    const doc = {
      startViewTransition(update: () => void) {
        update();
        return { ready: Promise.resolve() };
      },
      documentElement: { animate },
    };
    expect(runThemeReveal({ apply, origin, viewport, doc, reduceMotion: false })).toBe("animated");
    expect(apply).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    const radius = revealRadius(origin, viewport);
    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animate.mock.calls[0];
    expect(keyframes.clipPath).toEqual([`circle(0px at 350px 60px)`, `circle(${radius}px at 350px 60px)`]);
    expect(options.pseudoElement).toBe("::view-transition-new(root)");
  });

  it("still switches the theme if starting the transition throws", () => {
    const apply = vi.fn();
    const doc = {
      startViewTransition() {
        throw new Error("document hidden");
      },
      documentElement: { animate: vi.fn() },
    };
    expect(runThemeReveal({ apply, origin, viewport, doc, reduceMotion: false })).toBe("instant");
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
