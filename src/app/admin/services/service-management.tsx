"use client";

import { buttonPrimary, buttonSecondary, field } from "../../_ui/styles";
import { createServiceAction, toggleServiceAction, updateServiceAction } from "../actions";
import { AdminSubpage, AdminUnauthorized, message, useAdminData, type AdminData } from "../admin-management";

const label = "mb-1.5 block text-subhead font-medium text-ink";

export function ServiceManagement({ initialData }: { initialData: AdminData }) {
  const { data, busy, startTransition, feedback, setFeedback, refresh } = useAdminData(initialData);

  if (data.status === "UNAUTHORIZED") return <AdminUnauthorized />;

  const services = data.services.status === "listed" ? data.services.services : [];

  return (
    <AdminSubpage title="Hizmetler" feedback={feedback}>
      <section aria-labelledby="service-new-title">
        <h2 id="service-new-title" className="group-label">Yeni hizmet</h2>
        <form
          className="inset-group space-y-4 p-4"
          action={(formData) =>
            startTransition(async () => {
              const result = await createServiceAction({
                name: String(formData.get("name") ?? ""),
                durationMinutes: Number(formData.get("durationMinutes") ?? 0),
                bufferMinutes: Number(formData.get("bufferMinutes") ?? 0),
              });
              setFeedback(message(result.status));
              if (result.status === "created") refresh();
            })
          }
        >
          <div>
            <label htmlFor="service-new-name" className={label}>Hizmet adı</label>
            <input id="service-new-name" name="name" required autoComplete="off" className={field} />
          </div>
          <div className="flex gap-3">
            <div className="w-1/2">
              <label htmlFor="service-new-duration" className={label}>Süre (dk)</label>
              <input id="service-new-duration" name="durationMinutes" required type="number" min="1" inputMode="numeric" className={`${field} tabular-nums`} />
            </div>
            <div className="w-1/2">
              <label htmlFor="service-new-buffer" className={label}>Ara (dk)</label>
              <input id="service-new-buffer" name="bufferMinutes" type="number" min="0" inputMode="numeric" className={`${field} tabular-nums`} />
            </div>
          </div>
          <button disabled={busy} className={`${buttonPrimary} w-full`}>
            Hizmet ekle
          </button>
        </form>
      </section>

      <section aria-labelledby="service-list-title">
        <h2 id="service-list-title" className="group-label">Hizmet listesi</h2>
        {services.length === 0 ? (
          <p className="inset-group p-4 text-body text-ink-muted">Henüz hizmet yok. Yukarıdan ilk hizmeti ekleyin.</p>
        ) : (
          <ul className="inset-group">
            {services.map((item) => (
              <li key={item.id} className="inset-row p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-headline [overflow-wrap:anywhere]">{item.name}</p>
                    <p className="text-footnote text-ink-muted tabular-nums">
                      {item.durationMinutes} dk · {item.bufferMinutes} dk ara
                    </p>
                    <p className="text-footnote text-ink-muted">{item.active ? "Aktif" : "Pasif"}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className={`${buttonSecondary} shrink-0`}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await toggleServiceAction(item.id, !item.active);
                        setFeedback(message(result.status));
                        if (result.status === "updated") refresh();
                      })
                    }
                  >
                    {item.active ? "Pasifleştir" : "Aktifleştir"}
                  </button>
                </div>
                <form
                  className="space-y-2 border-t border-separator pt-3"
                  action={(formData) =>
                    startTransition(async () => {
                      const result = await updateServiceAction(item.id, {
                        name: String(formData.get("name") ?? ""),
                        durationMinutes: Number(formData.get("durationMinutes") ?? 0),
                        bufferMinutes: Number(formData.get("bufferMinutes") ?? 0),
                      });
                      setFeedback(
                        result.status === "updated"
                          ? "Hizmet bilgileri güncellendi."
                          : message(result.status),
                      );
                      if (result.status === "updated") refresh();
                    })
                  }
                >
                  <input name="name" required defaultValue={item.name} aria-label="Hizmet adı" className={field} />
                  <div className="flex gap-2">
                    <div className="w-1/2">
                      <input
                        name="durationMinutes"
                        required
                        type="number"
                        min="1"
                        inputMode="numeric"
                        defaultValue={item.durationMinutes}
                        aria-label="Hizmet süresi (dk)"
                        className={`${field} tabular-nums`}
                      />
                    </div>
                    <div className="w-1/2">
                      <input
                        name="bufferMinutes"
                        type="number"
                        min="0"
                        inputMode="numeric"
                        defaultValue={item.bufferMinutes}
                        aria-label="Ara süresi (dk)"
                        className={`${field} tabular-nums`}
                      />
                    </div>
                  </div>
                  <button disabled={busy} className={`${buttonSecondary} w-full`}>
                    Bilgileri kaydet
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminSubpage>
  );
}
