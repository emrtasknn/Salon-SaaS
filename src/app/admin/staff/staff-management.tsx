"use client";

import { field } from "../../_ui/styles";
import { createStaffAction, setStaffStatusAction, updateStaffProfileAction } from "../actions";
import { AdminSubpage, AdminUnauthorized, message, useAdminData, type AdminData } from "../admin-management";
import { Button } from "@/components/ui/button";
import { StatusToggle } from "../../_ui/status-toggle";
import { ServesAsStaffToggle } from "../serves-as-staff-toggle";

const label = "mb-1.5 block text-subhead font-medium text-ink";

export function StaffManagement({ initialData }: { initialData: AdminData }) {
  const { data, busy, startTransition, feedback, setFeedback, refresh } = useAdminData(initialData);

  if (data.status === "UNAUTHORIZED") return <AdminUnauthorized />;

  const staff = data.staff.status === "listed" && data.staff.staff ? data.staff.staff : [];

  return (
    <AdminSubpage title="Personel" feedback={feedback}>
      <ServesAsStaffToggle initialEnabled={data.adminServesAsStaff} />
      <section aria-labelledby="staff-new-title">
        <h2 id="staff-new-title" className="group-label">Yeni personel</h2>
        <form
          className="inset-group space-y-4 p-4"
          action={(formData) =>
            startTransition(async () => {
              const result = await createStaffAction({
                displayName: String(formData.get("displayName") ?? ""),
                email: String(formData.get("email") ?? ""),
                phone: String(formData.get("phone") ?? ""),
                password: String(formData.get("password") ?? ""),
              });
              setFeedback(
                result.status === "created"
                  ? formData.get("password")
                    ? "Personel oluşturuldu. E-posta ve geçici şifreyi personele iletin; giriş yaptıktan sonra şifresini değiştirebilir."
                    : "Personel oluşturuldu."
                  : message(result.status),
              );
              if (result.status === "created") refresh();
            })
          }
        >
          <div>
            <label htmlFor="staff-new-name" className={label}>Ad soyad</label>
            <input id="staff-new-name" name="displayName" required autoComplete="off" className={field} />
          </div>
          <div>
            <label htmlFor="staff-new-email" className={label}>E-posta</label>
            <input id="staff-new-email" name="email" type="email" autoComplete="off" className={field} />
          </div>
          <div>
            <label htmlFor="staff-new-phone" className={label}>Telefon</label>
            <input id="staff-new-phone" name="phone" type="tel" autoComplete="off" className={`${field} tabular-nums`} />
          </div>
          <div>
            <label htmlFor="staff-new-password" className={label}>Geçici şifre (isteğe bağlı)</label>
            <input
              id="staff-new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              aria-describedby="staff-password-hint"
              className={field}
            />
            <p id="staff-password-hint" className="mt-1.5 text-footnote text-ink-muted">
              En az 8 karakter; e-posta gerekir. Boş bırakırsanız personele davet e-postası gönderilir.
            </p>
          </div>
          <Button type="submit" disabled={busy} variant="primary" className="w-full">
            Personel ekle
          </Button>
        </form>
      </section>

      <section aria-labelledby="staff-list-title">
        <h2 id="staff-list-title" className="group-label">Ekip</h2>
        {staff.length === 0 ? (
          <p className="inset-group p-4 text-body text-ink-muted">Henüz personel yok. Yukarıdan ilk personeli ekleyin.</p>
        ) : (
          <ul className="inset-group">
            {staff.map((item) => (
              <li key={item.id} className="inset-row p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-headline [overflow-wrap:anywhere]">{item.displayName}</p>
                    <p className="text-footnote text-ink-muted tabular-nums">{item.phone || "Telefon belirtilmemiş"}</p>
                  </div>
                  <StatusToggle
                    active={item.status === "ACTIVE"}
                    name={item.displayName}
                    disabled={busy}
                    onToggle={() =>
                      startTransition(async () => {
                        const result = await setStaffStatusAction(
                          item.id,
                          item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                        );
                        setFeedback(message(result.status));
                        if (result.status === "updated") refresh();
                      })
                    }
                  />
                </div>
                <form
                  className="space-y-2 border-t border-separator pt-3"
                  action={(formData) =>
                    startTransition(async () => {
                      const result = await updateStaffProfileAction(item.id, {
                        displayName: String(formData.get("displayName") ?? ""),
                        phone: String(formData.get("phone") ?? ""),
                      });
                      setFeedback(
                        result.status === "updated"
                          ? "Personel bilgileri güncellendi."
                          : message(result.status),
                      );
                      if (result.status === "updated") refresh();
                    })
                  }
                >
                  <input
                    name="displayName"
                    required
                    defaultValue={item.displayName}
                    aria-label="Personel adı"
                    className={field}
                  />
                  <input
                    name="phone"
                    type="tel"
                    defaultValue={item.phone ?? ""}
                    aria-label="Personel telefonu"
                    placeholder="Telefon"
                    className={`${field} tabular-nums`}
                  />
                  <Button type="submit" disabled={busy} variant="secondary" className="w-full">
                    Bilgileri kaydet
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminSubpage>
  );
}
