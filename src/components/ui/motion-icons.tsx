"use client";

import { useEffect, type ComponentType } from "react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { cx } from "@/lib/utils";

/*
 * Icon micro-interactions adapted from Amicro buttons (MIT, © Syed Subhan Uddin,
 * https://amicro.dev/buttons): "morph" (btn-12 Theme, btn-18 Visibility) swaps two icons with a
 * spring scale/fade; "ring" (btn-10 Subscribe) swings a bell. Colors come from the parent
 * (currentColor). Reduced motion: instant swap, no swing.
 */

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false"; strokeWidth?: number }>;

const spring = { type: "spring", stiffness: 600, damping: 28 } as const;

/** Shows `icon` and morphs to the new one whenever `iconKey` changes. */
export function MorphIcon({
  icon: Icon,
  iconKey,
  className = "size-5",
}: {
  icon: IconComponent;
  iconKey: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <span className={cx("relative inline-flex shrink-0 items-center justify-center", className)} aria-hidden="true">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={iconKey}
          className="inline-flex"
          initial={reduceMotion ? false : { scale: 0.5, opacity: 0, rotate: -30 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { scale: 0.5, opacity: 0, rotate: 30 }}
          transition={spring}
        >
          <Icon className={className} aria-hidden strokeWidth={2} />
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Bell that swings once each time `ringKey` changes to a value above 0. */
export function RingingIcon({
  icon: Icon,
  ringKey,
  className = "size-5",
}: {
  icon: IconComponent;
  ringKey: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  useEffect(() => {
    if (ringKey <= 0 || reduceMotion || !scope.current) return;
    const controls = animate(scope.current, { rotate: [0, 16, -14, 10, -6, 3, 0] }, { duration: 0.7, ease: "easeInOut" });
    return () => controls.stop();
  }, [ringKey, reduceMotion, animate, scope]);
  return (
    <span ref={scope} aria-hidden="true" className="inline-flex origin-top">
      <Icon className={className} aria-hidden strokeWidth={2} />
    </span>
  );
}
