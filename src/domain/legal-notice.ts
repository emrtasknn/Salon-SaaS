import { createHash } from "node:crypto";
import { createTenantKvkkContactEmail, createTenantLegalAddress, createTenantLegalName } from "./tenant";

// WP-10: versioned legal texts (DRAFT, pending owner + legal counsel approval; see
// docs/legal/musteri-aydinlatma-metni.md and docs/legal/whatsapp-izin-metni.md).
// Texts are rendered on the server from tenant fields; the UI only displays strings.
// Any change to a template's wording MUST bump its `version`: stored hashes prove which
// exact text was shown for a booking.

export type LegalTemplate = Readonly<{ version: string; draft: boolean }>;

export const CUSTOMER_NOTICE: LegalTemplate = Object.freeze({ version: "draft-2026-11-07", draft: true });
// Owner decision 2026-11-07: one opt-in covers SMS (Twilio) and WhatsApp; texts are channel-neutral.
export const WHATSAPP_OPTIN: LegalTemplate = Object.freeze({ version: "draft-2026-11-07", draft: true });
export const STAFF_VERBAL_OPTIN: LegalTemplate = Object.freeze({ version: "draft-2026-11-07", draft: true });

/** Visible marker for values not decided yet (retention periods, platform legal name, ...). */
export const LEGAL_PLACEHOLDER_PENDING = "[belirlenecek]";

/**
 * Platform (data processor) name shown to customers. Owner decision 2026-11-06:
 * "RandevuN platformu" until the legal entity name is registered.
 */
export const PLATFORM_PROVIDER_NAME = "RandevuN platformu";

/** Tenant fields the notice is rendered from (server-side only). */
export type LegalNoticeTenant = Readonly<{
  name: string;
  legalName: string | null;
  legalAddress: string | null;
  kvkkContactEmail: string | null;
  contactPhone: string | null;
}>;

/** Customer-facing opt-out method (status-link button, WP-10). */
const OPT_OUT_METHOD = "randevu durum bağlantınızdaki \"Bildirimleri durdur\" düğmesiyle";

/** SHA-256 of the exact UTF-8 text, lowercase hex (matches the DB CHECK on AppointmentContact). */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** True when the salon's KVKK controller identity is complete and valid (booking form may open). */
export function isLegalReady(tenant: Pick<LegalNoticeTenant, "legalName" | "legalAddress" | "kvkkContactEmail">): boolean {
  const name = createTenantLegalName(tenant.legalName);
  const address = createTenantLegalAddress(tenant.legalAddress);
  const email = createTenantKvkkContactEmail(tenant.kvkkContactEmail);
  return name.ok && name.value !== null && name.value === tenant.legalName
    && address.ok && address.value !== null && address.value === tenant.legalAddress
    && email.ok && email.value !== null && email.value === tenant.kvkkContactEmail;
}

function field(value: string | null): string {
  return value !== null && value.trim() !== "" ? value : LEGAL_PLACEHOLDER_PENDING;
}

/** Layer 1: short notice shown above the submit button (plain text; the link is rendered by the UI). */
export function renderShortNotice(tenant: LegalNoticeTenant): string {
  return [
    "Kişisel verileriniz hakkında",
    `Randevunuz için verdiğiniz ad soyad, e-posta ve telefon bilgilerinizi veri sorumlusu ${tenant.name}, randevunuzu oluşturmak ve yönetmek amacıyla işler. Bilgileriniz, randevu sistemini sağlayan ${PLATFORM_PROVIDER_NAME} ve altyapı hizmet sağlayıcıları (bir kısmı yurt dışında) tarafından salon adına işlenir. Haklarınız ve ayrıntılar için Aydınlatma Metni'ni inceleyebilirsiniz.`,
  ].join("\n");
}

/** Layer 2: full notice, plain text with "\n" line breaks. */
export function renderFullNotice(tenant: LegalNoticeTenant): string {
  const P = LEGAL_PLACEHOLDER_PENDING;
  const contact = [`Adres: ${field(tenant.legalAddress)}`, `E-posta: ${field(tenant.kvkkContactEmail)}`];
  if (tenant.contactPhone) contact.push(`Telefon: ${tenant.contactPhone}`);
  return [
    `${tenant.name} Randevu Sistemi Kişisel Verilerin İşlenmesine İlişkin Aydınlatma Metni`,
    `Sürüm: ${CUSTOMER_NOTICE.version} · Yürürlük: ${P}`,
    "",
    "6698 sayılı Kişisel Verilerin Korunması Kanunu (\"KVKK\") 10. maddesi uyarınca, kişisel verilerinizin işlenmesine ilişkin olarak sizi bilgilendirmek isteriz.",
    "",
    "1. Veri sorumlusu",
    `Kişisel verileriniz, veri sorumlusu sıfatıyla ${field(tenant.legalName)} ("Salon") tarafından işlenmektedir.`,
    contact.join(" · "),
    `Online randevu sistemi ${PLATFORM_PROVIDER_NAME} ("Platform") tarafından sağlanır. Platform, verilerinizi yalnızca Salon adına ve Salon'un talimatıyla işleyen veri işleyendir.`,
    "",
    "2. İşlenen kişisel veriler",
    "- Kimlik: Ad soyad",
    "- İletişim: E-posta adresi; telefon numarası (isteğe bağlı)",
    "- Müşteri işlem: Seçilen hizmet, personel, randevu tarihi ve saati, randevu durumu (beklemede, onaylandı, reddedildi, iptal edildi, tamamlandı) ve değişiklik zamanları; Salon çalışanlarının müşteri kaydınıza eklediği notlar",
    "- İşlem güvenliği: Kötüye kullanımı önlemek için IP adresiniz ve telefon numaranızdan gizli bir anahtarla türetilen (takma adlandırılmış) sayaç anahtarları; randevu durum bağlantınızın hash değeri; barındırma hizmet sağlayıcısının istek kayıtlarında IP adresiniz, tarayıcı bilgileriniz ve ziyaret ettiğiniz sayfa adresleri",
    "- Bildirim kayıtları: İzin vermeniz hâlinde gönderilen SMS ve WhatsApp mesajlarının gönderim ve teslim durumu",
    "Salon, randevu notlarına sağlık bilgisi gibi özel nitelikli kişisel veri yazmamakla yükümlüdür; sistem bu tür verilerin işlenmesi için tasarlanmamıştır.",
    "",
    "3. İşleme amaçları ve hukuki sebepler (KVKK m.5/2)",
    "- Randevu talebinizi almak, uygunluk kontrolü, onay/ret/iptal işlemleri, size randevu durum bağlantısı vermek: (c) Bir sözleşmenin kurulması veya ifasıyla doğrudan ilgili olması",
    "- İzin vermeniz hâlinde randevunuzla ilgili SMS veya WhatsApp bilgilendirmesi göndermek (talep alındı, onaylandı, reddedildi, saati değişti): (c) Sözleşmenin ifası. Bu kanalların kullanımı ayrıca isteğinize bağlıdır.",
    "- Salon'un müşteri kayıtlarını ve randevu geçmişini tutması: (f) Veri sorumlusunun meşru menfaati",
    "- Sistemin kötüye kullanılmasını ve aşırı istekleri önlemek, bilgi güvenliğini sağlamak: (f) Veri sorumlusunun meşru menfaati",
    "- Mevzuattan doğan saklama ve bilgi verme yükümlülükleri, yetkili makam talepleri: (ç) Veri sorumlusunun hukuki yükümlülüğü",
    "- Bir uyuşmazlıkta hakların tesisi, kullanılması veya korunması: (e) Bir hakkın tesisi, kullanılması veya korunması",
    "Verileriniz pazarlama veya reklam amacıyla kullanılmaz ve satılmaz.",
    "",
    "4. Toplama yöntemi",
    "Kişisel verileriniz; Salon'un online randevu formunu doldurmanız yoluyla elektronik ortamda, kısmen otomatik yollarla; ya da telefonla veya yüz yüze verdiğiniz bilgilerin Salon çalışanlarınca sisteme girilmesi yoluyla toplanır. İşlem güvenliği verileri, form kullanımınız sırasında otomatik olarak oluşturulur.",
    "",
    "5. Aktarım",
    "Kişisel verileriniz, yukarıdaki amaçlarla sınırlı olarak:",
    `- Veri işleyenlere: Platform'a ve Platform'un altyapı için kullandığı hizmet sağlayıcılara (barındırma ve veri tabanı, uygulama sunumu, SMS ve WhatsApp mesaj iletimi). Güncel liste: ${P}.`,
    "- Yetkili kamu kurum ve kuruluşlarına: mevzuatın gerektirdiği hâllerde",
    "aktarılabilir.",
    "Yurt dışına aktarım: Bu hizmet sağlayıcıların bir kısmı verileri yurt dışındaki sunucularda işler (örneğin SMS mesajları Twilio, WhatsApp mesajları Meta Platforms altyapısı üzerinden iletilir). Bu aktarımlar KVKK m.9'da öngörülen uygun güvencelerden biri (Kurul'un ilan ettiği standart sözleşme) kullanılarak yapılır.",
    "",
    "6. Saklama süresi",
    `Kişisel verileriniz ${P} süreyle saklanır; bu sürenin sonunda veya işleme şartları ortadan kalktığında silinir, yok edilir ya da anonim hâle getirilir. Kötüye kullanım önleme sayaçları en fazla 1 saatlik süreler için kullanılır ve en geç ${P} içinde silinir; barındırma istek kayıtları ${P} saklanır; randevu durum bağlantınız randevu bitiminden 7 gün sonrasına kadar geçerlidir.`,
    "",
    "7. Haklarınız (KVKK m.11)",
    "Salon'a başvurarak:",
    "a) kişisel verilerinizin işlenip işlenmediğini öğrenme,",
    "b) işlenmişse buna ilişkin bilgi talep etme,",
    "c) işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,",
    "ç) yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,",
    "d) eksik veya yanlış işlenmişse düzeltilmesini isteme,",
    "e) KVKK m.7 çerçevesinde silinmesini veya yok edilmesini isteme,",
    "f) (d) ve (e) bentleri uyarınca yapılan işlemlerin, verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme,",
    "g) münhasıran otomatik sistemlerle analiz edilmesi suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme,",
    "ğ) kanuna aykırı işlenmesi sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme",
    "haklarına sahipsiniz.",
    "",
    "8. Başvuru",
    `Taleplerinizi, Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ'e uygun olarak; ${field(tenant.legalAddress)} adresine yazılı olarak, ${field(tenant.kvkkContactEmail)} adresine Salon'a daha önce bildirdiğiniz ve sistemde kayıtlı e-posta adresinizden ya da kayıtlı elektronik posta (KEP) ile iletebilirsiniz. Başvurunuz en geç 30 gün içinde ücretsiz olarak sonuçlandırılır; işlemin ayrıca bir maliyet gerektirmesi hâlinde Kurul'ca belirlenen tarife uygulanabilir.`,
    "Platform'a doğrudan gelen başvurular, cevaplanmak üzere gecikmeksizin Salon'a iletilir.",
    `SMS ve WhatsApp bilgilendirme iznini geri almak için: ${OPT_OUT_METHOD}.`,
  ].join("\n");
}

/** Exact text recorded for a public booking: short notice (shown above submit) + full notice (linked). */
export function renderNoticeRecordText(tenant: LegalNoticeTenant): string {
  return `${renderShortNotice(tenant)}\n\n${renderFullNotice(tenant)}`;
}

export function customerNoticeHash(tenant: LegalNoticeTenant): string {
  return sha256Hex(renderNoticeRecordText(tenant));
}

/** Public-form notification (SMS / WhatsApp) opt-in checkbox label + help text. */
export function renderWhatsAppOptIn(tenant: Pick<LegalNoticeTenant, "name">): Readonly<{ label: string; help: string }> {
  return {
    label: `${tenant.name} randevumla ilgili bilgilendirmeleri (talebimin alınması, onaylanması, reddedilmesi veya saatinin değişmesi) SMS veya WhatsApp üzerinden, girdiğim telefon numarasına almak istiyorum. (isteğe bağlı)`,
    help: `Mesajlar ${tenant.name} adına, randevu sistemimizin SMS hattından veya WhatsApp hesabından gönderilir. Bu kanallardan reklam veya kampanya mesajı gönderilmez. İzninizi istediğiniz zaman ${OPT_OUT_METHOD} geri alabilirsiniz.`,
  };
}

export function whatsAppOptInHash(tenant: Pick<LegalNoticeTenant, "name">): string {
  const { label, help } = renderWhatsAppOptIn(tenant);
  return sha256Hex(`${label}\n${help}`);
}

/** Staff/admin create form: checkbox recording a verbal notification (SMS / WhatsApp) opt-in given by the customer. */
export function renderStaffVerbalOptIn(): string {
  return "Müşteri, randevusuyla ilgili bilgilendirmeleri (talep alındı, onaylandı, reddedildi, saati değişti) SMS veya WhatsApp üzerinden girilen telefon numarasına almaya sözlü olarak izin verdi.";
}

export function staffVerbalOptInHash(): string {
  return sha256Hex(renderStaffVerbalOptIn());
}
