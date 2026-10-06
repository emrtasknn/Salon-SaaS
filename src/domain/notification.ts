export type NotificationEventType = "APPOINTMENT_CREATED" | "APPOINTMENT_CONFIRMED" | "APPOINTMENT_REJECTED";
export type NotificationChannel = "WHATSAPP";
export type NotificationDeliveryStatus = "PENDING" | "SENT" | "DELIVERED" | "FAILED";

export type NotificationRecipient = Readonly<{
  profileId: string;
  displayName: string;
  phone: string | null;
  templateKey: string;
  body: string;
  templateParameters: ReadonlyArray<string>;
}>;

export function recipientsForEvent(eventType: NotificationEventType, input: Readonly<{
  customer: Readonly<{ profileId: string; displayName: string; phone: string | null }>;
  staff: Readonly<{ profileId: string; displayName: string; phone: string | null }>;
  serviceName: string;
  startAt: Date;
  timeZone: string;
}>): ReadonlyArray<NotificationRecipient> {
  const time = new Intl.DateTimeFormat("tr-TR", { timeZone: input.timeZone, dateStyle: "short", timeStyle: "short" }).format(input.startAt);
  const customerBody = eventType === "APPOINTMENT_CONFIRMED"
    ? `Randevunuz onaylandı. ${input.serviceName} — ${time} — ${input.staff.displayName}.`
    : eventType === "APPOINTMENT_REJECTED"
      ? `Randevu talebiniz onaylanmadı. ${input.serviceName} — ${time}.`
      : `Randevu talebiniz oluşturuldu ve onay bekliyor. ${input.serviceName} — ${time}.`;
  if (eventType === "APPOINTMENT_CREATED") {
    return [
      { profileId: input.staff.profileId, displayName: input.staff.displayName, phone: input.staff.phone, templateKey: "appointment-created-staff", body: `Yeni randevu talebi: ${input.customer.displayName} — ${input.serviceName} — ${time}. Onay bekliyor.`, templateParameters: [input.customer.displayName, input.serviceName, time] },
      { profileId: input.customer.profileId, displayName: input.customer.displayName, phone: input.customer.phone, templateKey: "appointment-created-customer", body: customerBody, templateParameters: [input.serviceName, time] },
    ];
  }
  return [{ profileId: input.customer.profileId, displayName: input.customer.displayName, phone: input.customer.phone,
    templateKey: eventType === "APPOINTMENT_CONFIRMED" ? "appointment-confirmed-customer" : "appointment-rejected-customer",
    body: customerBody,
    templateParameters: eventType === "APPOINTMENT_CONFIRMED" ? [input.serviceName, time, input.staff.displayName] : [input.serviceName, time],
  }];
}
