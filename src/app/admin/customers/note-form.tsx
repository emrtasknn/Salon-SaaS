"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { field } from "../../_ui/styles";
import { haptic } from "@/lib/haptics";
import { addCustomerNote } from "./actions";

const MESSAGES: Record<string, string> = {
  INVALID_INPUT: "Not boş olamaz.",
  NOT_FOUND: "Müşteri bulunamadı.",
  UNAUTHORIZED: "Bu işlem için yetkiniz yok.",
  PERSISTENCE_FAILURE: "Not kaydedilemedi. Lütfen tekrar deneyin.",
};

/** Adds a note to a customer through the existing TENANT_ADMIN-only server action. */
export function CustomerNoteForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) {
      setError(MESSAGES.INVALID_INPUT);
      return;
    }
    startTransition(async () => {
      const result = await addCustomerNote(customerId, body);
      if (result.status === "created") {
        setBody("");
        setError(null);
        haptic("success");
        router.refresh();
        return;
      }
      setError(MESSAGES[result.status] ?? MESSAGES.PERSISTENCE_FAILURE);
      haptic("error");
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-2">
      <label htmlFor="customer-note" className="sr-only">Yeni not</label>
      <div className="flex gap-2">
        <input
          id="customer-note"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Not ekleyin (ör. kısa saç sever)"
          maxLength={500}
          className={`${field} min-w-0 flex-1`}
        />
        <Button type="submit" leadingIcon={Plus} pending={pending}>Ekle</Button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </form>
  );
}
