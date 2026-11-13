"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { checkboxClassName, field } from "../../_ui/styles";
import {
  createServiceAction,
  createServiceCategoryAction,
  deleteServiceCategoryAction,
  moveServiceCategoryAction,
  renameServiceCategoryAction,
  toggleServiceAction,
  updateServiceAction,
} from "../actions";
import { AdminSubpage, AdminUnauthorized, message, useAdminData, type AdminData } from "../admin-management";
import { Button } from "@/components/ui/button";
import { StatusToggle } from "../../_ui/status-toggle";
import { formatServicePrice, parseTryAmount } from "../../../domain/service-price";
import { groupServicesByCategory } from "../../../domain/service-category";

const label = "mb-1.5 block text-subhead font-medium text-ink";
const PRICE_HINT = "Örn. 450 veya 450,50. Boş bırakırsanız fiyat gösterilmez.";
const PRICE_INVALID = "Fiyatı 450 ya da 1.250,50 gibi yazın (en fazla 100.000 ₺).";

type Category = Readonly<{ id: string; name: string; sortOrder: number }>;

/** Reads the category/price fields of a service form; null = invalid price (feedback already set). */
function readCatalog(formData: FormData, setFeedback: (text: string) => void) {
  const price = parseTryAmount(String(formData.get("price") ?? ""));
  if (price === "INVALID") {
    setFeedback(PRICE_INVALID);
    return null;
  }
  const categoryId = String(formData.get("categoryId") ?? "");
  return {
    categoryId: categoryId === "" ? null : categoryId,
    priceMinor: price,
    priceIsFrom: price !== null && formData.get("priceIsFrom") === "on",
  };
}

/** Price as the admin typed it ("450" or "450,50") for the edit field. */
function priceInputValue(priceMinor: number | null | undefined) {
  if (priceMinor === null || priceMinor === undefined) return "";
  return priceMinor % 100 === 0 ? String(priceMinor / 100) : (priceMinor / 100).toFixed(2).replace(".", ",");
}

function CatalogFields({
  idPrefix,
  categories,
  categoryId,
  priceMinor,
  priceIsFrom,
}: {
  idPrefix: string;
  categories: ReadonlyArray<Category>;
  categoryId?: string | null;
  priceMinor?: number | null;
  priceIsFrom?: boolean;
}) {
  return (
    <>
      {categories.length > 0 && (
        <div>
          <label htmlFor={`${idPrefix}-category`} className={label}>Kategori</label>
          <select id={`${idPrefix}-category`} name="categoryId" defaultValue={categoryId ?? ""} className={field}>
            <option value="">Kategorisiz</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={`${idPrefix}-price`} className={label}>Fiyat (₺, isteğe bağlı)</label>
        <input
          id={`${idPrefix}-price`}
          name="price"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={priceInputValue(priceMinor)}
          aria-describedby={`${idPrefix}-price-hint`}
          className={`${field} tabular-nums`}
        />
        <p id={`${idPrefix}-price-hint`} className="mt-1 text-footnote text-ink-muted">{PRICE_HINT}</p>
      </div>
      <label className="tap-target flex items-center gap-3 text-body text-ink">
        <input type="checkbox" name="priceIsFrom" defaultChecked={priceIsFrom ?? false} className={checkboxClassName} />
        Başlangıç fiyatı (“ve üzeri” yazar)
      </label>
    </>
  );
}

export function ServiceManagement({ initialData }: { initialData: AdminData }) {
  const { data, busy, startTransition, feedback, setFeedback, refresh } = useAdminData(initialData);

  if (data.status === "UNAUTHORIZED") return <AdminUnauthorized />;

  const services = data.services.status === "listed" ? data.services.services : [];
  const categories: ReadonlyArray<Category> = data.serviceCategories ?? [];
  const groups = groupServicesByCategory(categories, services);

  return (
    <AdminSubpage title="Hizmetler" feedback={feedback}>
      <section aria-labelledby="category-title">
        <h2 id="category-title" className="group-label">Kategoriler</h2>
        <p className="px-4 pb-2 text-subhead text-ink-muted">
          Müşteri sayfasında hizmetler bu başlıklar altında, bu sırayla görünür. İsteğe bağlıdır. Örneğin: Bakım, Muayene, Özel ders.
        </p>
        <div className="inset-group">
          {categories.length > 0 && (
            <ul>
              {categories.map((category, index) => (
                <li key={category.id} className="inset-row p-4">
                  <form
                    className="flex items-center gap-2"
                    action={(formData) =>
                      startTransition(async () => {
                        const result = await renameServiceCategoryAction(category.id, String(formData.get("name") ?? ""));
                        setFeedback(result.status === "updated" ? "Kategori adı kaydedildi." : message(result.status));
                        if (result.status === "updated") refresh();
                      })
                    }
                  >
                    <input
                      name="name"
                      required
                      maxLength={60}
                      defaultValue={category.name}
                      aria-label={`${category.name} kategorisinin adı`}
                      className={`${field} min-w-0 flex-1`}
                    />
                    <Button type="submit" variant="secondary" disabled={busy}>Kaydet</Button>
                  </form>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      leadingIcon={ArrowUp}
                      aria-label={`${category.name} yukarı taşı`}
                      disabled={busy || index === 0}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await moveServiceCategoryAction(category.id, "up");
                          if (result.status === "updated") refresh();
                          else setFeedback(message(result.status));
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      leadingIcon={ArrowDown}
                      aria-label={`${category.name} aşağı taşı`}
                      disabled={busy || index === categories.length - 1}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await moveServiceCategoryAction(category.id, "down");
                          if (result.status === "updated") refresh();
                          else setFeedback(message(result.status));
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="danger-outline"
                      className="ml-auto"
                      disabled={busy}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await deleteServiceCategoryAction(category.id);
                          setFeedback(
                            result.status === "deleted"
                              ? `"${category.name}" silindi. İçindeki hizmetler kategorisiz kaldı.`
                              : message(result.status),
                          );
                          if (result.status === "deleted") refresh();
                        })
                      }
                    >
                      Sil
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form
            className={`flex gap-2 p-4 ${categories.length > 0 ? "border-t border-separator" : ""}`}
            action={(formData) =>
              startTransition(async () => {
                const result = await createServiceCategoryAction(String(formData.get("name") ?? ""));
                setFeedback(result.status === "created" ? "Kategori eklendi." : message(result.status));
                if (result.status === "created") refresh();
              })
            }
          >
            <label htmlFor="category-new-name" className="sr-only">Yeni kategori adı</label>
            <input
              id="category-new-name"
              name="name"
              required
              maxLength={60}
              autoComplete="off"
              placeholder="Yeni kategori"
              className={`${field} min-w-0 flex-1`}
            />
            <Button type="submit" variant="secondary" disabled={busy}>Ekle</Button>
          </form>
        </div>
      </section>

      <section aria-labelledby="service-new-title">
        <h2 id="service-new-title" className="group-label">Yeni hizmet</h2>
        <form
          className="inset-group space-y-4 p-4"
          // onSubmit (not a form action): React resets an action form after every submit, which
          // would wipe what the admin typed when the price is rejected or the save fails.
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const formData = new FormData(form);
            const catalog = readCatalog(formData, setFeedback);
            if (!catalog) return;
            startTransition(async () => {
              const result = await createServiceAction({
                name: String(formData.get("name") ?? ""),
                durationMinutes: Number(formData.get("durationMinutes") ?? 0),
                bufferMinutes: Number(formData.get("bufferMinutes") ?? 0),
                ...catalog,
              });
              setFeedback(result.status === "created" ? "Hizmet eklendi." : message(result.status));
              if (result.status === "created") {
                form.reset();
                refresh();
              }
            });
          }}
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
              <label htmlFor="service-new-buffer" className={label}>Sonrası boşluk (dk)</label>
              <input id="service-new-buffer" name="bufferMinutes" type="number" min="0" inputMode="numeric" className={`${field} tabular-nums`} />
            </div>
          </div>
          <CatalogFields idPrefix="service-new" categories={categories} />
          <Button type="submit" disabled={busy} variant="primary" className="w-full">
            Hizmet ekle
          </Button>
        </form>
      </section>

      <section aria-labelledby="service-list-title">
        <h2 id="service-list-title" className="group-label">Hizmet listesi</h2>
        {services.length === 0 ? (
          <p className="inset-group p-4 text-body text-ink-muted">Henüz hizmet yok. Yukarıdan ilk hizmeti ekleyin.</p>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.id ?? "none"}>
                {group.name && <h3 className="px-4 pb-1.5 text-subhead font-semibold text-ink-muted">{group.name}</h3>}
                <ul className="inset-group">
                  {group.services.map((item) => {
                    const price = formatServicePrice(item.priceMinor, item.priceIsFrom);
                    return (
                      <li key={item.id} className="inset-row p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-headline [overflow-wrap:anywhere]">{item.name}</p>
                            <p className="text-footnote text-ink-muted tabular-nums">
                              {item.durationMinutes} dk · {item.bufferMinutes} dk boşluk{price ? ` · ${price}` : ""}
                            </p>
                          </div>
                          <StatusToggle
                            active={item.active}
                            name={item.name}
                            disabled={busy}
                            onToggle={() =>
                              startTransition(async () => {
                                const result = await toggleServiceAction(item.id, !item.active);
                                setFeedback(result.status === "updated" ? "Hizmet durumu güncellendi." : message(result.status));
                                if (result.status === "updated") refresh();
                              })
                            }
                          />
                        </div>
                        <form
                          className="space-y-3 border-t border-separator pt-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const formData = new FormData(event.currentTarget);
                            const catalog = readCatalog(formData, setFeedback);
                            if (!catalog) return;
                            startTransition(async () => {
                              const result = await updateServiceAction(item.id, {
                                name: String(formData.get("name") ?? ""),
                                durationMinutes: Number(formData.get("durationMinutes") ?? 0),
                                bufferMinutes: Number(formData.get("bufferMinutes") ?? 0),
                                ...catalog,
                              });
                              setFeedback(result.status === "updated" ? "Hizmet bilgileri kaydedildi." : message(result.status));
                              if (result.status === "updated") refresh();
                            });
                          }}
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
                                aria-label="Randevu sonrası boşluk (dk)"
                                className={`${field} tabular-nums`}
                              />
                            </div>
                          </div>
                          <CatalogFields
                            idPrefix={`service-${item.id}`}
                            categories={categories}
                            categoryId={item.categoryId}
                            priceMinor={item.priceMinor}
                            priceIsFrom={item.priceIsFrom}
                          />
                          <Button type="submit" disabled={busy} variant="secondary" className="w-full">
                            Bilgileri kaydet
                          </Button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminSubpage>
  );
}
