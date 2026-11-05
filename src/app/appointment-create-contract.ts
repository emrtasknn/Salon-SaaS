// WP-08 UI <-> server-action contract (types only, no runtime code).
// Server actions live in:
//   src/app/admin/calendar-actions.ts  (admin create-appointment flow)
//   src/app/staff/actions.ts           (staff create-appointment flow, self only)
//   src/app/admin/closure-actions.ts   (admin closed dates)
// The UI never sends tenantId; staff never send staffId (derived server-side).
//
// Action signatures:
//   admin/calendar-actions.ts
//     getAdminCreateOptions(): Promise<CreateOptionsView | null>
//     listAdminSlots(input: { serviceId: string; staffId: string; date: LocalDateIso }): Promise<SlotListResult>
//     searchAdminCustomers(query: string): Promise<ReadonlyArray<CustomerSearchResultView>>
//     createAdminAppointment(input: AdminCreateAppointmentInput): Promise<CreateAppointmentResult>
//   staff/actions.ts
//     getStaffCreateOptions(): Promise<CreateOptionsView | null>
//     listStaffSlots(input: { serviceId: string; date: LocalDateIso }): Promise<SlotListResult>
//     createStaffAppointment(input: StaffCreateAppointmentInput): Promise<CreateAppointmentResult>
//   admin/closure-actions.ts
//     listClosures(input: { from: LocalDateIso; to: LocalDateIso }): Promise<ClosureListResult>
//     previewClosureImpact(date: LocalDateIso): Promise<ClosureImpactResult>
//     createClosure(input: CreateClosureInput): Promise<CreateClosureResult>
//     deleteClosure(closureId: string): Promise<DeleteClosureResult>

import type { VerbalOptInView } from "./legal-consent-contract";

/** "YYYY-MM-DD", a local calendar date in the tenant's timezone. */
export type LocalDateIso = string;

export type CreateOptionsView = Readonly<{
  timezone: string;
  services: ReadonlyArray<Readonly<{ id: string; name: string; durationMinutes: number }>>;
  /** Admin: all ACTIVE staff. Staff: only themselves. */
  staff: ReadonlyArray<Readonly<{ id: string; displayName: string }>>;
  /** WP-10: label/version of the "customer gave verbal WhatsApp opt-in" checkbox (server template). */
  verbalOptIn: VerbalOptInView;
}>;

export type SlotView = Readonly<{
  /** UTC instant, ISO 8601. Send back unchanged as `startAt`. */
  startAt: string;
  /** Local "HH:mm" in the tenant timezone, for display. */
  label: string;
}>;

export type SlotListResult =
  | Readonly<{ status: "OK"; slots: ReadonlyArray<SlotView> }>
  | Readonly<{ status: "CLOSED_DATE" | "TENANT_INACTIVE" | "INVALID_INPUT" | "FORBIDDEN" }>;

export type CustomerSearchResultView = Readonly<{
  profileId: string;
  displayName: string;
  phone: string | null;
  email: string | null;
}>;

export type GuestCustomerInput = Readonly<{
  kind: "guest";
  displayName: string;
  /** E.164 preferred; required for a WhatsApp notification. */
  phone?: string;
  /** Admin only; staff guest form has no email field. */
  email?: string;
}>;

export type ExistingCustomerInput = Readonly<{ kind: "existing"; profileId: string }>;

export type AdminCreateAppointmentInput = Readonly<{
  serviceId: string;
  staffId: string;
  startAt: string;
  customer: ExistingCustomerInput | GuestCustomerInput;
  notifyCustomer: boolean;
  /** WP-10: customer gave a verbal WhatsApp opt-in; requires an E.164 phone (guest input or CRM profile). */
  whatsappVerbalOptIn: boolean;
}>;

/** Staff create for themselves only and enter a guest customer (no CRM search). */
export type StaffCreateAppointmentInput = Readonly<{
  serviceId: string;
  startAt: string;
  customer: Omit<GuestCustomerInput, "email">;
  notifyCustomer: boolean;
  /** WP-10: customer gave a verbal WhatsApp opt-in; requires an E.164 phone. */
  whatsappVerbalOptIn: boolean;
}>;

export type CreateAppointmentResult =
  | Readonly<{ status: "CREATED"; appointmentId: string; notified: boolean }>
  /** Admin guest email matches an existing customer: UI offers to use that customer instead. */
  | Readonly<{ status: "EMAIL_EXISTS"; existing: CustomerSearchResultView }>
  | Readonly<{
      status:
        | "SLOT_UNAVAILABLE"
        | "CLOSED_DATE"
        | "TENANT_INACTIVE"
        | "CUSTOMER_NOT_FOUND"
        | "INVALID_INPUT"
        | "FORBIDDEN"
        /** WP-10: verbal opt-in ticked but the customer has no valid (E.164) phone. */
        | "OPT_IN_REQUIRES_PHONE";
    }>;

export type ClosureView = Readonly<{ id: string; date: LocalDateIso; reason: string | null }>;

export type ClosureListResult =
  | Readonly<{ status: "OK"; timezone: string; closures: ReadonlyArray<ClosureView> }>
  | Readonly<{ status: "FORBIDDEN" | "INVALID_INPUT" }>;

export type ClosureImpactAppointmentView = Readonly<{
  id: string;
  /** Local "HH:mm". */
  startLabel: string;
  staffName: string;
  customerName: string;
  status: "PENDING" | "CONFIRMED";
}>;

export type ClosureImpactResult =
  | Readonly<{ status: "OK"; appointments: ReadonlyArray<ClosureImpactAppointmentView> }>
  | Readonly<{ status: "FORBIDDEN" | "INVALID_INPUT" }>;

export type CreateClosureInput = Readonly<{
  date: LocalDateIso;
  reason?: string;
  /** Must be true when the date has PENDING/CONFIRMED appointments (decision d: warn + confirm, no auto-cancel). */
  confirmExistingAppointments: boolean;
}>;

export type CreateClosureResult =
  | Readonly<{ status: "CREATED"; closure: ClosureView }>
  | Readonly<{ status: "HAS_APPOINTMENTS"; appointments: ReadonlyArray<ClosureImpactAppointmentView> }>
  | Readonly<{ status: "DUPLICATE" | "PAST_DATE" | "INVALID_INPUT" | "FORBIDDEN" }>;

export type DeleteClosureResult = Readonly<{ status: "DELETED" | "NOT_FOUND" | "FORBIDDEN" }>;
