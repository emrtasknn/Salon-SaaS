"use client";

import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";

import type { TourId } from "./tour-steps";
import { browserTourStorage, resetTour } from "./tour-storage";

/**
 * Settings row: forget that the tour was seen on this device and go to the page it runs on,
 * where it starts again. Presentation only.
 */
export function ReplayTourRow({ tour, href }: { tour: TourId; href: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        resetTour(browserTourStorage(), tour);
        router.push(href);
      }}
      className="focus-ring tap-target flex w-full items-center gap-3 px-4 py-3 text-left text-body text-ink [outline-offset:-2px] hover:bg-surface-muted active:bg-surface-muted"
    >
      <span className="min-w-0 flex-1">Tanıtım turunu tekrar izle</span>
      <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
    </button>
  );
}
