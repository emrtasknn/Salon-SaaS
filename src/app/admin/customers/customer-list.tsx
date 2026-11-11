import Link from "next/link";
import { formatShortDate } from "../../_ui/date-format";
import { initials } from "../../_ui/display-name";
import { formatPhone } from "../../_ui/phone-format";

export type CustomerListItem = Readonly<{
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  appointmentCount: number;
  lastAppointmentAt: Date | string | null;
}>;

/** Phone (formatted) when there is one, otherwise the e-mail; null when neither is on file. */
export function customerContact(customer: Pick<CustomerListItem, "email" | "phone">): string | null {
  if (customer.phone) return formatPhone(customer.phone);
  return customer.email;
}

/**
 * Customer rows in the shared inset group: initials, name, one contact line, and on the right the
 * visit count with the last visit. Every row has the same shape so the list scans in a straight
 * line. Presentation only: the list is already tenant-scoped and authorized by the loader.
 */
export function CustomerList({ customers, now }: { customers: ReadonlyArray<CustomerListItem>; now: Date }) {
  return (
    <ul className="inset-group">
      {customers.map((customer) => {
        const contact = customerContact(customer);
        return (
          <li key={customer.id} className="inset-row">
            <Link
              href={`/admin/customers?id=${encodeURIComponent(customer.id)}`}
              className="focus-ring flex min-h-14 items-center gap-3 px-4 py-2.5 [outline-offset:-2px] hover:bg-surface-muted active:bg-surface-muted"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-footnote font-semibold text-ink"
              >
                {initials(customer.displayName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-subhead font-semibold text-ink">{customer.displayName}</span>
                {contact ? <span className="block truncate text-footnote tabular-nums text-ink-muted">{contact}</span> : null}
              </span>
              <span className="shrink-0 text-right text-footnote tabular-nums text-ink-muted">
                {customer.lastAppointmentAt ? (
                  <>
                    <span className="block">{customer.appointmentCount} randevu</span>
                    <span className="block">{formatShortDate(customer.lastAppointmentAt, now)}</span>
                  </>
                ) : (
                  <span className="block">Henüz randevu yok</span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
