"use client";

import { useEffect } from "react";
import "driver.js/dist/driver.css";
import "./tour.css";

import { availableTourSteps, tourSteps, type TourId } from "./tour-steps";
import { browserTourStorage, hasSeenTour, markTourSeen } from "./tour-storage";

/** Lets the page settle (fonts, layout, push banner) before the overlay measures elements. */
const START_DELAY_MS = 700;

/**
 * The visible element for a `data-tour` value. The same tab exists in the phone tab bar and the
 * desktop segmented nav; only one of them is displayed, so take the one with a layout box.
 */
function visibleTourElement(target: string): Element | null {
  const selector = `[data-tour="${CSS.escape(target)}"]`;
  for (const element of document.querySelectorAll(selector)) {
    if (element.getClientRects().length > 0) return element;
  }
  return null;
}

/**
 * First-visit product tour (driver.js), shown once per device and area. Renders nothing itself.
 * Presentation only: it reads and writes a localStorage flag and never touches tenant data,
 * authorization or appointments.
 */
export function ProductTour({ tour }: { tour: TourId }) {
  useEffect(() => {
    const storage = browserTourStorage();
    if (hasSeenTour(storage, tour)) return;

    let cancelled = false;
    let destroy: (() => void) | null = null;

    const timer = window.setTimeout(async () => {
      // The script is only fetched for someone who has not seen the tour yet.
      const { driver } = await import("driver.js");
      if (cancelled) return;

      const steps = availableTourSteps(tourSteps(tour), (target) => visibleTourElement(target) !== null);
      if (steps.length === 0) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const instance = driver({
        steps: steps.map((step) => ({
          // Resolved when the step shows, so a re-rendered element is still found.
          element: step.target === null ? undefined : () => visibleTourElement(step.target!) as Element,
          popover: { title: step.title, description: step.description },
        })),
        animate: !reduceMotion,
        smoothScroll: !reduceMotion,
        showProgress: true,
        progressText: "{{current}} / {{total}}",
        nextBtnText: "İleri",
        prevBtnText: "Geri",
        doneBtnText: "Bitir",
        closeBtnLabel: "Turu kapat",
        popoverClass: "salon-tour",
        stagePadding: 6,
        stageRadius: 14,
        overlayOpacity: 0.55,
        // The page is not usable under the overlay; a stray tap must not end the tour by accident.
        overlayClickBehavior: "none",
        skipMissingElement: true,
        onDestroyed: (_element, _step, opts) => {
          // "api" = we tore it down (navigation, unmount): show it again next time.
          if (opts.reason !== "api") markTourSeen(storage, tour);
        },
      });
      destroy = () => instance.destroy();
      instance.drive();
    }, START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      destroy?.();
    };
  }, [tour]);

  return null;
}
