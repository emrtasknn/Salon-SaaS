"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";

/**
 * Two-step button for actions that cannot be undone (reject, cancel): the first
 * press shows an inline question with the real action and "Vazgeç". Same idea as
 * an iOS destructive action sheet, kept inline so it works inside sheets/lists.
 */
export function ConfirmButton({
  label,
  question,
  detail,
  confirmLabel,
  onConfirm,
  variant = "danger-outline",
  size,
  disabled,
  className,
  defaultOpen = false,
}: {
  label: string;
  question: string;
  detail?: string;
  confirmLabel: string;
  onConfirm: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
  /** Test/preview only. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  const wasOpen = useRef(defaultOpen);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
    else if (wasOpen.current) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!open) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        className={className}
        onClick={() => {
          haptic("warning");
          setOpen(true);
        }}
      >
        {label}
      </Button>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={questionId}
      className="w-full basis-full rounded-control border border-destructive/30 bg-status-rejected-bg/40 p-3"
    >
      <p id={questionId} className="text-subhead font-semibold text-ink">{question}</p>
      {detail ? <p className="mt-0.5 text-footnote text-ink-muted">{detail}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          ref={confirmRef}
          type="button"
          variant="danger"
          size={size}
          disabled={disabled}
          className="flex-1 sm:flex-none"
          onClick={() => {
            setOpen(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
        <Button type="button" variant="secondary" size={size} className="flex-1 sm:flex-none" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}
