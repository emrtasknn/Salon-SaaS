# SMS / WhatsApp Bilgilendirme İzni — TASLAK

> **2026-11-07 (sahip kararı):** Tek izin kutusu hem SMS (Twilio) hem WhatsApp için geçerli; metin kanal-bağımsız yapıldı (sürüm `draft-2026-11-07`). SMS yalnızca müşteriye ve yalnızca onay / ret / saat değişikliği için gider.

> **Durum:** TASLAK `v0.1` · 2026-11-04 · **Avukat onayı bekliyor; yayınlanamaz.** Hukuki tavsiye değildir.

## Sahip kararı (WP-10, 2026-11-04)

- WhatsApp izni **isteğe bağlıdır**, aydınlatma kutusundan **ayrıdır** ve **varsayılan olarak işaretsizdir**.
- İzin yoksa müşteriye **hiç WhatsApp gönderilmez**. Randevu yine oluşturulur; müşteri durumu randevu durum bağlantısından izler.
- Telefon numarası girilmemişse kutu devre dışıdır.

## Neden ayrı bir izin?

- **KVKK açısından** randevu bilgilendirmesi sözleşmenin ifasına dayanır (m.5/2-c); bu kutu bir "açık rıza" değildir ve öyle adlandırılmamalıdır.
- **Meta açısından** opt-in, kişinin işletmeden iletişim almayı kabul ettiğini ve **işletmenin adını** açıkça belirtmelidir (Meta "Getting opt-in" sayfası, 2026-11-04 kontrolü). WhatsApp'ın adıyla anılması zorunlu değil ama netlik için metinde geçiyor. Meta, önceden işaretli kutu konusunda kural koymuyor; işaretsiz kutu yine de en güvenli yol.
- **6563 sayılı ETK açısından** m.6/1 ticari elektronik ileti için onay ister; mal veya hizmetin kullanımıyla ilgili iletiler, iletişim bilgisi o işlem için verildiyse onaydan muaftır. Randevu bilgilendirmesi büyük olasılıkla bu kapsamda, ancak kanunda adıyla sayılmıyor (**avukat teyidi**). Bu yüzden bu kanaldan **kampanya, indirim veya tanıtım gönderilmez**.

## Formda gösterilecek metin

> ☐ **{{salonAdi}}** randevumla ilgili bilgilendirmeleri (talebimin alınması, onaylanması, reddedilmesi veya saatinin değişmesi) **SMS veya WhatsApp** üzerinden, girdiğim telefon numarasına almak istiyorum. *(isteğe bağlı)*
>
> <small>Mesajlar {{salonAdi}} adına, randevu sistemimizin SMS hattından veya WhatsApp hesabından gönderilir. Bu kanallardan reklam veya kampanya mesajı gönderilmez. İzninizi istediğiniz zaman {{whatsappIzinGeriAlmaYontemi}} geri alabilirsiniz.</small>

## Kayıt

Randevu ile birlikte saklanır: izin verildi/verilmedi, izin metni sürümü ve hash'i, zaman (UTC), telefon numarası (E.164), tenant ve randevu kimliği; geri alındıysa geri alma zamanı.

## Açık noktalar

- **Paylaşımlı gönderici:** Pilotta mesajlar platformun tek WhatsApp numarasından gider. **Bugünkü şablonlar salon adını göndermiyor** (`src/persistence/prisma-notification.ts`); bu metin yayınlanmadan önce şablonlara salon adı eklenmeli (Meta şablon onayı gerekir). Meta'nın paylaşımlı kullanıma yazılı onayı henüz yok (WP-02); production bu onaya bağlı.
- **Hangi numara:** Bugün aynı e-postayla gelen müşteri mevcut profile bağlanıyor ve yeni girilen telefon yok sayılıyor (`src/persistence/prisma-public-booking.ts`). Bu durumda mesaj eski numaraya gider; başkasının e-postasını yazan biri randevuyu o kişinin profiline bağlayabilir. WP-10'da çözülmeden "girdiğim telefon numarasına" vaadi doğru olmaz (KVKK m.4 doğruluk ilkesi).
- **Mevcut durum:** Kod, telefon girildiyse bugün izin sormadan WhatsApp gönderiyor. Bu metin, izin kapısı (WP-10) yayına alınmadan kullanılamaz.
- **Geri alma yöntemi** (`{{whatsappIzinGeriAlmaYontemi}}`) karar bekliyor. Seçenekler: durum bağlantısındaki "Bildirimleri durdur" düğmesi (uygulandı, WP-10; 2026-11-07 itibarıyla SMS'i de durdurur) veya WhatsApp'a "DUR" yazmak (webhook'ta gelen mesaj işleme gerektirir; şu an yok).
