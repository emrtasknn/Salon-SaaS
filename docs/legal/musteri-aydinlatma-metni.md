# Müşteri Aydınlatma Metni — TASLAK

> **Durum:** TASLAK `v0.1` · 2026-11-04 · **Avukat onayı bekliyor; yayınlanamaz.**
> Hukuki tavsiye değildir. Ajan tarafından KVKK m.10 ve Aydınlatma Tebliği esas alınarak hazırlandı.
> Avukat soruları: [`README.md`](README.md) "Avukata açık sorular".

## Nasıl kullanılır (uygulama notu)

- **Veri sorumlusu salondur**, platform veri işleyendir. Bu yüzden metin her salon için ayrı gösterilir; `{{...}}` alanları sunucuda tenant kaydından doldurulur.
- Randevu formunda **kısa metin (katman 1)** ve tam metne bağlantı gösterilir. Tam metin (katman 2) `/[slug]/aydinlatma` gibi ayrı bir sayfada durur.
- **Aydınlatma için kutu yoktur** (sahip kararı, 2026-11-04). Kurum'un 26.06.2020 duyurusu, aydınlatmanın okunduğunun onaylanmasını hizmetin ön koşulu yapmayı eksiklik sayar. Kısa metin, gönder düğmesinin hemen üstünde her zaman görünür; ispat için randevuyla birlikte gösterilen metnin sürümü ve hash'i sunucuda kaydedilir.
- Formdaki **tek kutu WhatsApp iznidir**; ayrı başlık altında, isteğe bağlı ve işaretsizdir ([`whatsapp-izin-metni.md`](whatsapp-izin-metni.md)). Açık rıza ifadesi kullanılmaz.
- Randevu kaydında saklanır: metin sürümü, metnin hash'i (doldurulmuş hâliyle), bildirim zamanı (UTC), tenant ve randevu kimliği. Bu kayda IP veya tarayıcı bilgisi **eklenmez** (barındırma sağlayıcısının istek logları ayrıdır; bkz. §2).

| Alan | Kaynak | Örnek |
|---|---|---|
| `{{salonUnvani}}` | Salonun ticari unvanı / şahıs işletmesi adı | Ada Güzellik Ltd. Şti. |
| `{{salonAdi}}` | `Tenant.name` | Salon Ada |
| `{{salonAdresi}}` | Salonun tebligat adresi | — |
| `{{salonEposta}}` | KVKK başvuru e-postası | kvkk@salonada.com |
| `{{salonTelefon}}` | `Tenant.contactPhone` | +90 555 111 22 33 |
| `{{platformUnvani}}` | Platform işletmecisi. Sahip kararı 2026-11-06: tüzel kişilik adı belli olana kadar "RandevuN platformu" (`PLATFORM_PROVIDER_NAME`) | RandevuN platformu |
| `{{saklamaSuresi}}` | Avukat/salon kararı | Son randevudan itibaren 2 yıl |
| `{{metinSurumu}}` | Sabit | v1 |

> **Not:** `salonUnvani`, `salonAdresi` ve `salonEposta` bugün `Tenant` modelinde yok. WP-10 uygulamasında salon ayarlarına eklenmeleri gerekir (migration). Bu alanlar boşken salonun randevu formu yayına açılmamalıdır.

---

## Katman 1 — Formda gösterilen kısa metin

> **Kişisel verileriniz hakkında**
> Randevunuz için verdiğiniz ad soyad, e-posta ve telefon bilgilerinizi veri sorumlusu **{{salonAdi}}**, randevunuzu oluşturmak ve yönetmek amacıyla işler. Bilgileriniz, randevu sistemini sağlayan **{{platformUnvani}}** ve altyapı hizmet sağlayıcıları (bir kısmı yurt dışında) tarafından salon adına işlenir. Haklarınız ve ayrıntılar için [Aydınlatma Metni]({{aydinlatmaUrl}}).

---

## Katman 2 — Tam metin

### {{salonAdi}} Randevu Sistemi Kişisel Verilerin İşlenmesine İlişkin Aydınlatma Metni

Sürüm: {{metinSurumu}} · Yürürlük: {{yururlukTarihi}}

6698 sayılı Kişisel Verilerin Korunması Kanunu ("**KVKK**") 10. maddesi uyarınca, kişisel verilerinizin işlenmesine ilişkin olarak sizi bilgilendirmek isteriz.

#### 1. Veri sorumlusu

Kişisel verileriniz, veri sorumlusu sıfatıyla **{{salonUnvani}}** ("**Salon**") tarafından işlenmektedir.
Adres: {{salonAdresi}} · E-posta: {{salonEposta}} · Telefon: {{salonTelefon}}

Online randevu sistemi **{{platformUnvani}}** ("**Platform**") tarafından sağlanır. Platform, verilerinizi yalnızca Salon adına ve Salon'un talimatıyla işleyen **veri işleyen**dir.

#### 2. İşlenen kişisel veriler

| Kategori | Veriler |
|---|---|
| Kimlik | Ad soyad |
| İletişim | E-posta adresi; telefon numarası (isteğe bağlı) |
| Müşteri işlem | Seçilen hizmet, personel, randevu tarihi ve saati, randevu durumu (beklemede, onaylandı, reddedildi, iptal edildi, tamamlandı) ve değişiklik zamanları; Salon çalışanlarının müşteri kaydınıza eklediği notlar |
| İşlem güvenliği | Kötüye kullanımı önlemek için IP adresiniz ve telefon numaranızdan gizli bir anahtarla türetilen (takma adlandırılmış) sayaç anahtarları; randevu durum bağlantınızın hash değeri; barındırma hizmet sağlayıcısının istek kayıtlarında IP adresiniz, tarayıcı bilgileriniz ve ziyaret ettiğiniz sayfa adresleri |
| Bildirim kayıtları | İzin vermeniz hâlinde gönderilen SMS ve WhatsApp mesajlarının gönderim ve teslim durumu |

Salon, randevu notlarına sağlık bilgisi gibi **özel nitelikli kişisel veri** yazmamakla yükümlüdür; sistem bu tür verilerin işlenmesi için tasarlanmamıştır.

#### 3. İşleme amaçları ve hukuki sebepler

| Amaç | Hukuki sebep (KVKK m.5/2) |
|---|---|
| Randevu talebinizi almak, uygunluk kontrolü, onay/ret/iptal işlemleri, size randevu durum bağlantısı vermek | (c) Bir sözleşmenin kurulması veya ifasıyla doğrudan ilgili olması |
| İzin vermeniz hâlinde randevunuzla ilgili SMS veya WhatsApp bilgilendirmesi göndermek (talep alındı, onaylandı, reddedildi, saati değişti) | (c) Sözleşmenin ifası. Bu kanalların kullanımı ayrıca isteğinize bağlıdır. |
| Salon'un müşteri kayıtlarını ve randevu geçmişini tutması | (f) Veri sorumlusunun meşru menfaati |
| Sistemin kötüye kullanılmasını ve aşırı istekleri önlemek, bilgi güvenliğini sağlamak | (f) Veri sorumlusunun meşru menfaati |
| Mevzuattan doğan saklama ve bilgi verme yükümlülükleri, yetkili makam talepleri | (ç) Veri sorumlusunun hukuki yükümlülüğü |
| Bir uyuşmazlıkta hakların tesisi, kullanılması veya korunması | (e) Bir hakkın tesisi, kullanılması veya korunması |

Verileriniz pazarlama veya reklam amacıyla **kullanılmaz** ve satılmaz.

#### 4. Toplama yöntemi

Kişisel verileriniz; Salon'un online randevu formunu doldurmanız yoluyla **elektronik ortamda**, kısmen otomatik yollarla; ya da telefonla veya yüz yüze verdiğiniz bilgilerin Salon çalışanlarınca sisteme girilmesi yoluyla toplanır. İşlem güvenliği verileri, form kullanımınız sırasında otomatik olarak oluşturulur.

#### 5. Aktarım

Kişisel verileriniz, yukarıdaki amaçlarla sınırlı olarak:

- **Veri işleyenlere:** Platform'a ve Platform'un altyapı için kullandığı hizmet sağlayıcılara (barındırma ve veri tabanı, uygulama sunumu, SMS ve WhatsApp mesaj iletimi). Güncel liste: {{altIsleyenListesiUrl}}.
- **Yetkili kamu kurum ve kuruluşlarına:** mevzuatın gerektirdiği hâllerde.

aktarılabilir.

**Yurt dışına aktarım:** Bu hizmet sağlayıcıların bir kısmı verileri yurt dışındaki sunucularda işler (örneğin SMS mesajları Twilio, WhatsApp mesajları Meta Platforms altyapısı üzerinden iletilir). Bu aktarımlar KVKK m.9'da öngörülen uygun güvencelerden biri (Kurul'un ilan ettiği standart sözleşme) kullanılarak yapılır. *[AVUKAT: sağlayıcı bazında aktarım aracı teyit edilecek; bkz. `veri-isleme-sozlesmesi.md` §8.]*

#### 6. Saklama süresi

Kişisel verileriniz {{saklamaSuresi}} süreyle saklanır; bu sürenin sonunda veya işleme şartları ortadan kalktığında silinir, yok edilir ya da anonim hâle getirilir. Kötüye kullanım önleme sayaçları en fazla 1 saatlik süreler için kullanılır ve en geç {{sayacSilmeSuresi}} içinde silinir *[UYGULAMA: bugün temizlik fırsat düştükçe yapılıyor; düzenli temizlik işi gelmeden bu süre yazılamaz]*; barındırma istek kayıtları {{istekLogSaklamaSuresi}} saklanır; randevu durum bağlantınız randevu bitiminden 7 gün sonrasına kadar geçerlidir.

#### 7. Haklarınız (KVKK m.11)

Salon'a başvurarak:

a) kişisel verilerinizin işlenip işlenmediğini öğrenme,
b) işlenmişse buna ilişkin bilgi talep etme,
c) işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,
ç) yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,
d) eksik veya yanlış işlenmişse düzeltilmesini isteme,
e) KVKK m.7 çerçevesinde silinmesini veya yok edilmesini isteme,
f) (d) ve (e) bentleri uyarınca yapılan işlemlerin, verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme,
g) münhasıran otomatik sistemlerle analiz edilmesi suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme,
ğ) kanuna aykırı işlenmesi sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme

haklarına sahipsiniz.

#### 8. Başvuru

Taleplerinizi, Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ'e uygun olarak; {{salonAdresi}} adresine yazılı olarak, {{salonEposta}} adresine Salon'a daha önce bildirdiğiniz ve sistemde kayıtlı e-posta adresinizden ya da kayıtlı elektronik posta (KEP) ile iletebilirsiniz. Başvurunuz en geç **30 gün** içinde ücretsiz olarak sonuçlandırılır; işlemin ayrıca bir maliyet gerektirmesi hâlinde Kurul'ca belirlenen tarife uygulanabilir.

Platform'a doğrudan gelen başvurular, cevaplanmak üzere gecikmeksizin Salon'a iletilir.

SMS ve WhatsApp bilgilendirme iznini geri almak için: {{whatsappIzinGeriAlmaYontemi}}.
