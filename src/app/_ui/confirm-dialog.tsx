"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";

/** Confirm is enabled only when idle and, if a text is required, the typed text equals it exactly. */
export function canConfirm({ requireText, typed, pending }: { requireText?: string; typed: string; pending: boolean }) {
  if (pending) return false;
  return requireText === undefined || typed === requireText;
}

/** Escape and backdrop may cancel only while no request is in flight. */
export function canDismiss(pending: boolean) {
  return !pending;
}

/*
 * ConfirmDialog — destructive confirmation on a native modal <dialog> (showModal): the browser
 * makes the rest of the page inert and traps Tab. Bottom sheet on phones, centered from sm.
 * Presentation only; the server action decides whether the delete is allowed.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Sil",
  requireText,
  requireTextLabel,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  requireText?: string;
  requireTextLabel?: string;
  pending?: boolean;
  error?: string | null;
  onConfirm(typedText?: string): void;
  onCancel(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      setTyped("");
      trigger?.focus();
    };
  }, [open]);

  if (!open) return null;

  const enabled = canConfirm({ requireText, typed, pending });

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        // Escape: never let the browser close it by itself; the parent owns `open`.
        event.preventDefault();
        if (canDismiss(pending)) onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && canDismiss(pending)) onCancel();
      }}
      className="sheet-motion mx-0 mb-0 mt-auto max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-sheet border-0 bg-surface p-0 text-ink shadow-sheet backdrop:bg-black/40 sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-md sm:rounded-sheet"
    >
      <form
        className="flex flex-col gap-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (enabled) onConfirm(requireText === undefined ? undefined : typed);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h2 id={titleId} className="text-headline">
            {title}
          </h2>
          <p id={descriptionId} className="text-body text-ink-muted">
            {description}
          </p>
        </div>
        {requireText !== undefined ? (
          <Input
            label={requireTextLabel}
            aria-label={requireTextLabel ?? "Onay metni"}
            value={typed}
            onChange={setTyped}
            isDisabled={pending}
            autoComplete="off"
          />
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} variant="secondary" disabled={pending} onClick={onCancel}>
            Vazgeç
          </Button>
          <Button type="submit" variant="danger" pending={pending} disabled={!enabled}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
