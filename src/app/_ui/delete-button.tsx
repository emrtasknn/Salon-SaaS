"use client";

import { useState, useTransition } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";
import type { DeleteResult } from "@/domain/deletion";
import { ConfirmDialog } from "./confirm-dialog";
import { deleteErrorMessage } from "./delete-messages";

export type DeleteOutcome = Readonly<{ ok: true }> | Readonly<{ ok: false; error: string }>;

/**
 * Runs a delete action and turns its result into what the dialog needs: close on DELETED,
 * otherwise stay open with the Turkish reason. Presentation only; the server decides.
 */
export async function runDelete(
  run: (typedText?: string) => Promise<DeleteResult>,
  typedText?: string,
): Promise<DeleteOutcome> {
  try {
    const result = await run(typedText);
    if (result.status === "DELETED") return { ok: true };
    return { ok: false, error: deleteErrorMessage(result) };
  } catch {
    return { ok: false, error: deleteErrorMessage({ status: "PERSISTENCE_FAILURE" }) };
  }
}

/**
 * A quiet destructive trigger plus the shared ConfirmDialog. It owns only open/pending/error state;
 * whether the delete is allowed is always answered by the server action passed in `run`.
 */
export function DeleteButton({
  label = "Sil",
  ariaLabel,
  title,
  description,
  confirmLabel,
  requireText,
  requireTextLabel,
  run,
  onDeleted,
  variant = "danger-outline",
  size,
  disabled,
  className,
  defaultOpen = false,
}: {
  label?: string;
  /** Names what is being deleted, e.g. "Ayşe Yılmaz personelini sil". */
  ariaLabel: string;
  title: string;
  description: string;
  confirmLabel?: string;
  requireText?: string;
  requireTextLabel?: string;
  run: (typedText?: string) => Promise<DeleteResult>;
  /** Called once after DELETED, with the dialog already closed; refresh the screen here. */
  onDeleted: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
  /** Test/preview only. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setError(null);
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        className={className}
        aria-label={ariaLabel}
        onClick={() => {
          haptic("warning");
          setError(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        requireText={requireText}
        requireTextLabel={requireTextLabel}
        pending={pending}
        error={error}
        onCancel={close}
        onConfirm={(typed) =>
          startTransition(async () => {
            const outcome = await runDelete(run, typed);
            if (outcome.ok) {
              haptic("success");
              close();
              onDeleted();
            } else {
              haptic("error");
              setError(outcome.error);
            }
          })
        }
      />
    </>
  );
}
