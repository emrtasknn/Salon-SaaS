import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingContactSummary, differingContactFields } from "./booking-contact-summary";

const contact = {
  displayName: "Ayşe Yılmaz",
  phone: "+905551234567",
  email: "ayse@example.com",
  whatsapp: "OPTED_IN",
} as const;

describe("BookingContactSummary", () => {
  it("renders nothing without a booking contact", () => {
    expect(renderToStaticMarkup(<BookingContactSummary contact={null} profile={{}} />)).toBe("");
  });

  it("hides fields equal to the displayed profile", () => {
    const fields = differingContactFields(contact, {
      displayName: " ayşe yılmaz ",
      phone: "+905551234567",
      email: "AYSE@example.com",
    });
    expect(fields).toEqual([]);
    const html = renderToStaticMarkup(
      <BookingContactSummary contact={contact} profile={{ displayName: "Ayşe Yılmaz", phone: contact.phone, email: contact.email }} />,
    );
    expect(html).not.toContain("Randevuda girilen iletişim");
    expect(html).toContain("WhatsApp: izin var");
  });

  it("shows only differing fields read-only", () => {
    const html = renderToStaticMarkup(
      <BookingContactSummary contact={{ ...contact, whatsapp: "OPTED_OUT" }} profile={{ displayName: "Ayşe Yılmaz", phone: "+905550000000" }} />,
    );
    expect(html).toContain("Randevuda girilen iletişim");
    expect(html).toContain("+905551234567");
    expect(html).toContain("ayse@example.com");
    expect(html).not.toContain("<input");
    expect(html).toContain("WhatsApp: müşteri durdurdu");
  });
});
