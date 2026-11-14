"use client";

// Layout for /platform/tenants: list first, "Yeni işletme" opens the existing
// provisioning form in a sheet. Presentation only — the page has already checked
// platform access, and every server action re-checks it.

import { AccountRows } from "../../_ui/account-links";
import { PageHeader } from "../../_ui/page-header";
import { useId, useRef, useState } from "react";
import { statusNote } from "../../_ui/styles";
import { TenantProvisioningForm } from "./tenant-provisioning-form";
import { TenantStatusList } from "./tenant-status-list";
import { Button } from "@/components/ui/button";

type TenantRow = Readonly<{
  id: string;
  slug: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
}>;

export function PlatformTenantsView({ tenants }: { tenants: ReadonlyArray<TenantRow> | null }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [notice, setNotice] = useState("");

  function openSheet() {
    setNotice("");
    dialogRef.current?.showModal();
    headingRef.current?.focus();
  }

  function closeSheet() {
    dialogRef.current?.close();
  }

  return (
    <main className="min-h-screen bg-canvas">
      <PageHeader
        title="İşletmeler"
        eyebrow="Platform yönetimi"
        widthClassName="max-w-3xl"
        accessory={
          <Button ref={triggerRef} type="button" onClick={openSheet} aria-haspopup="dialog" variant="primary">
            Yeni işletme
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 pb-10 pt-6 sm:px-6">
        <p role="status" aria-live="polite" className={notice !== "" ? statusNote : "sr-only"}>{notice}</p>

        <section aria-labelledby="tenant-list-title" className="space-y-2">
          <h2 id="tenant-list-title" className="sr-only">İşletme listesi</h2>
          {tenants !== null ? (
            <TenantStatusList tenants={tenants} />
          ) : (
            <p role="status" className={statusNote}>İşletme listesi yüklenemedi.</p>
          )}
        </section>

        <section aria-labelledby="platform-account-title">
          <h2 id="platform-account-title" className="group-label">Hesap</h2>
          <AccountRows settingsHref="/platform/settings" settingsDetail="Görünüm, şifre" />
        </section>
      </div>

      {/* Native modal dialog: inert background, Esc closes, focus returns to the trigger.
          Bottom sheet on phones, centered dialog from 768px. */}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        onClose={() => triggerRef.current?.focus()}
        className="mx-0 mb-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-sheet border-0 bg-surface p-0 text-ink shadow-sheet backdrop:bg-black/40 backdrop:backdrop-blur-sm md:m-auto md:w-[calc(100%-2rem)] md:max-w-lg md:rounded-sheet"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-separator bg-surface px-4 py-3">
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-headline text-ink focus:outline-none">
            Yeni işletme
          </h2>
          <Button type="button" onClick={closeSheet} variant="secondary">
            Kapat
          </Button>
        </div>
        <div className="space-y-4 bg-canvas px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="text-subhead text-ink-muted">İşletmeyi ve ilk tenant admin hesabını oluşturun.</p>
          <TenantProvisioningForm
            onCreated={(salonName) => {
              closeSheet();
              setNotice(
                salonName !== ""
                  ? `${salonName} oluşturuldu. İlk tenant admin hesabı hazır.`
                  : "İşletme ve ilk tenant admin hesabı oluşturuldu.",
              );
            }}
          />
        </div>
      </dialog>
    </main>
  );
}
