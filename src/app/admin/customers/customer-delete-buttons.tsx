"use client";

import { useRouter } from "next/navigation";
import { DeleteButton } from "../../_ui/delete-button";
import { deleteCustomerAction, deleteCustomerNoteAction } from "./actions";

/** Delete trigger on the customer detail page; the server decides whether it is allowed. */
export function DeleteCustomerButton({ customerId, name }: { customerId: string; name: string }) {
  const router = useRouter();
  return (
    <DeleteButton
      ariaLabel={`${name} müşterisini sil`}
      title={`${name} silinsin mi?`}
      description="Ad, telefon, e-posta ve notlar kalıcı olarak silinir, geri alınamaz."
      confirmLabel="Müşteriyi sil"
      run={() => deleteCustomerAction(customerId)}
      onDeleted={() => router.replace("/admin/customers")}
    />
  );
}

/** Delete trigger for one customer note. */
export function DeleteNoteButton({ noteId }: { noteId: string }) {
  const router = useRouter();
  return (
    <DeleteButton
      ariaLabel="Notu sil"
      title="Not silinsin mi?"
      description="Bu not kalıcı olarak silinir, geri alınamaz."
      confirmLabel="Notu sil"
      variant="ghost"
      size="small"
      className="text-destructive"
      run={() => deleteCustomerNoteAction(noteId)}
      onDeleted={() => router.refresh()}
    />
  );
}
