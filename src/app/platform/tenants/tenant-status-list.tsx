"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusToggle } from "../../_ui/status-toggle";
import { field, statusNote } from "../../_ui/styles";
import { setTenantStatusAction } from "./actions";

type TenantRow = Readonly<{
  id: string;
  slug: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
}>;

const errorMessages: Record<string, string> = {
  INVALID_INPUT: "Geçersiz istek.",
  NOT_FOUND: "Salon bulunamadı. Liste yenilendi.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  PERSISTENCE_FAILURE: "Durum kaydedilemedi. Lütfen tekrar deneyin.",
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR");
}

/** Client-side filter by salon name or slug (presentation only). */
export function filterTenants<T extends TenantRow>(tenants: ReadonlyArray<T>, query: string): ReadonlyArray<T> {
  const needle = normalize(query).replace(/^\//, "");
  if (needle === "") return tenants;
  return tenants.filter(
    (tenant) => normalize(tenant.name).includes(needle) || normalize(tenant.slug).includes(needle),
  );
}

export function TenantStatusList({ tenants }: { tenants: ReadonlyArray<TenantRow> }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  if (tenants.length === 0) {
    return <p className={statusNote}>Henüz salon yok. “Yeni salon” ile ilk salonu oluşturun.</p>;
  }

  const visible = filterTenants(tenants, query);
  const filtering = normalize(query) !== "";

  return (
    <>
      <div className="space-y-2">
        <label htmlFor="tenant-search" className="sr-only">Salon ara</label>
        <input
          id="tenant-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ad veya bağlantı adı ile ara"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="tenant-count"
          className={field}
        />
        <p id="tenant-count" aria-live="polite" className="px-4 text-footnote text-ink-muted tabular-nums">
          {filtering ? `${visible.length} / ${tenants.length} salon` : `${tenants.length} salon`}
        </p>
      </div>
      <p role="status" aria-live="polite" className={message !== "" ? statusNote : "sr-only"}>{message}</p>
      {visible.length === 0 ? (
        <p className={statusNote}>“{query.trim()}” ile eşleşen salon yok.</p>
      ) : null}
      <ul className={visible.length === 0 ? "hidden" : "inset-group"}>
        {visible.map((tenant) => {
          const active = tenant.status === "ACTIVE";
          const next = active ? "INACTIVE" : "ACTIVE";
          return (
            <li key={tenant.id} className="inset-row flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-headline text-ink">{tenant.name}</p>
                <p className="truncate text-subhead text-ink-muted">/{tenant.slug}</p>
              </div>
              <form
                action={(formData) => {
                  setPendingId(tenant.id);
                  setMessage("");
                  startTransition(async () => {
                    try {
                      const result = await setTenantStatusAction(formData);
                      if (result.ok) {
                        setMessage(
                          next === "ACTIVE"
                            ? `${tenant.name} aktifleştirildi. Online randevu açık.`
                            : `${tenant.name} pasife alındı. Online ve yeni randevu alınmıyor.`,
                        );
                      } else {
                        setMessage(errorMessages[result.code] ?? "İşlem başarısız oldu.");
                      }
                      router.refresh();
                    } catch {
                      setMessage("İşlem sırasında beklenmeyen bir hata oluştu.");
                    } finally {
                      setPendingId("");
                    }
                  });
                }}
              >
                <input type="hidden" name="tenantId" value={tenant.id} />
                <input type="hidden" name="status" value={next} />
                <StatusToggle
                  type="submit"
                  active={active}
                  name={tenant.name}
                  disabled={busy}
                  pending={pendingId === tenant.id}
                />
              </form>
            </li>
          );
        })}
      </ul>
    </>
  );
}
