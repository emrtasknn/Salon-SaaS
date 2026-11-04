# Hukuki Metinler (KVKK) — Taslaklar

> **Hiçbiri yürürlükte değil.** Tüm dosyalar ajan tarafından hazırlanmış **taslaklardır**, hukuki tavsiye değildir. Avukat onayı olmadan yayınlanamaz, imzalanamaz ve uygulamaya gömülemez. Nihai metnin sahibi ürün sahibidir (WP-10 kısıtı).

## Dosyalar

| Paket | Dosya | Kime | Ne zaman gerekli |
|---|---|---|---|
| A | [`musteri-aydinlatma-metni.md`](musteri-aydinlatma-metni.md) | Randevu alan müşteri (veri sorumlusu: salon) | **MVP / pilot** — WP-10 kodundan önce |
| A | [`whatsapp-izin-metni.md`](whatsapp-izin-metni.md) | Randevu alan müşteri | **MVP / pilot** — WP-10 kodundan önce |
| B | [`veri-isleme-sozlesmesi.md`](veri-isleme-sozlesmesi.md) | Salon ↔ Platform | **Pilot** — gerçek müşteri verisinden önce imza |
| B | [`alt-isleyenler.md`](alt-isleyenler.md) | Sözleşme Ek-2 | Pilot; değişince 15 gün önceden bildirim |
| C | Salon kullanım koşulları, platform gizlilik politikası | Salonlar | Production öncesi — **henüz yazılmadı** |

## Süreç

1. salon-saas-research mevzuatı birincil kaynaktan teyit eder (WP-10 Agent log).
2. Ajan taslağı yazar → salon-saas-reviewer kod/veri gerçekleriyle tutarlılığı inceler.
3. ⛔ **Sahip + avukat** metni onaylar; dosyanın başındaki sürüm `v1` olur ve "TASLAK" kaldırılır.
4. WP-10 uygulaması: metin sürümü/hash kaydı, form kutuları, tenant alanları (migration).
5. Her metin değişikliği yeni sürüm demektir. Eski sürümlerin metni ve hash'i silinmez, çünkü geçmiş randevular o sürüme bağlıdır.

## Kaynak ve lisans

- `veri-isleme-sozlesmesi.md`, [General-Legal/legal-templates](https://github.com/General-Legal/legal-templates) deposundaki "Data Processing Addendum (Global)" şablonunun yapısından uyarlandı (CC0 1.0; atıf zorunlu değil, yazarlar dipnotun korunmasını rica ediyor).
- O depodaki diğer şablonlar ABD/AB hukukuna göredir; KVKK karşılıkları yoktur. Paket C için `terms-of-use`, `master-services-agreement` ve `privacy-policy-gdpr` iskelet olarak kullanılabilir. Tüketiciye tahkim ve toplu dava feragati gibi hükümler Türk hukukuna **taşınmamalıdır**.

## Teyit durumu (salon-saas-research, 2026-11-04)

Birincil kaynaktan teyit edilenler: aydınlatma içeriği ve katmanlı sunum (Kurum duyurusu 26.06.2020), standart sözleşmenin 5 iş günü içinde bildirimi (Kurum duyuruları), veri ihlalinde 72 saat (Kurul kararı 2019/10), Meta opt-in şartları.
**Teyit edilemeyenler (avukat kontrol etmeli):** m.9'un değişik tam metni, m.11/m.13 ifadeleri ve 30 günlük süre, standart sözleşme modül seçimi, saklama-imha politikası kapsamı, VERBİS eşikleri, ETK m.6'nın randevu mesajlarına uygulanışı, İlke Kararı 2026/347'nin Resmî Gazete metni (ikincil kaynaktan).

## Avukata açık sorular

1. **Yurt dışı aktarım (KVKK m.9):** Supabase, Vercel ve Meta'ya aktarım için hangi araç (standart sözleşme vb.)? Salon (veri sorumlusu) mu, Platform (veri işleyen) mı, ikisi birden mi taraf olur? Kurum'a bildirimi kim yapar? Sağlayıcıların kendi standart şartları yeterli mi?
2. **Saklama süresi:** Müşteri ve randevu verileri için makul süre (`{{saklamaSuresi}}`) ve dayanağı. Uygulamada otomatik silme/anonimleştirme henüz yok.
3. **E-posta zorunluluğu:** Formda e-posta zorunlu, ama müşteriye e-posta gönderilmiyor. Veri minimizasyonu açısından isteğe bağlı mı yapılmalı, yoksa amaç (kimlik/iletişim) yeterli mi?
4. **Meşru menfaat (m.5/2-f):** Müşteri geçmişi ve salon notları için yeterli mi? Denge testi kaydı gerekir mi?
5. **Aydınlatma kutusu (sahip kararıyla çelişki):** Kurum'un 2020 duyurusu, aydınlatmanın okunduğunun onaylanmasını hizmetin ön koşulu yapmayı eksiklik sayıyor. WP-10'daki "zorunlu kutu" kararı bununla uyumlu mu? Seçenekler `musteri-aydinlatma-metni.md` başında; önerilen: kutu yok, gösterilen sürüm kaydedilir.
6. **WhatsApp izni:** Opt-in metni; paylaşımlı göndericide salon adının mesajda geçmesi yeterli mi?
7. **VERBİS:** Kurul'un 2025/1572 (RG 01.10.2025) ve 2025/2393 sayılı kararlarıyla değişen istisna eşikleri ikincil kaynaklarda çelişkili. Salonlar ve Platform için kayıt yükümlülüğü ile saklama ve imha politikası zorunluluğu (Yönetmelik: periyodik imha aralığı en fazla 6 ay) teyit edilmeli.
8. **Veri ihlali:** 24 saatlik işleyen → sorumlu bildirim süresi ve Kurul'a 72 saat bildirim zinciri uygun mu?
9. **Web Push iletim hizmetleri:** İçeriği okuyamayan tarayıcı push hizmetleri alt işleyen sayılır mı?
10. **Ticari unvan ve adres:** Şahıs işletmesi salonlarda aydınlatmada hangi bilgiler zorunlu?

## Uygulamaya yansıyacak teknik ihtiyaçlar (WP-10 ve sonrası)

- `Tenant` üzerinde: ticari unvan, adres, KVKK başvuru e-postası (aydınlatma için zorunlu; boşken randevu formu kapalı).
- Randevu kaydında: aydınlatma metni sürümü + hash + zaman; WhatsApp izni + metin sürümü + zaman + geri alma zamanı.
- WhatsApp izni geri alma yolu (önerilen: durum bağlantısında düğme).
- Saklama süresine göre periyodik silme/anonimleştirme işi.
- Rate limit tablosunda süresi dolan kayıtların düzenli temizliği (şu an temizlik fırsat düştükçe yapılıyor).
- Salon verisinin dışa aktarımı (sözleşme §13.2) ve silinmesi.
- **Müşteri profili eşleştirme:** Randevu, e-postaya göre mevcut profile bağlanıyor ve yeni girilen ad/telefon yok sayılıyor. Başkasının e-postasını yazan biri randevuyu o kişinin profiline ve telefonuna bağlayabilir (KVKK m.4 doğruluk). WhatsApp izni bu çözülmeden doğru numaraya bağlanamaz.
- WhatsApp şablonlarına salon adı eklenmesi (Meta şablon onayı).
- Durum bağlantısı iptali (`revokedAt` hiç set edilmiyor) ve süresi dolan token kayıtlarının silinmesi.
- WhatsApp alıcı seçiminde personel aktiflik kontrolü (Web Push'ta var).
- Barındırma istek loglarında durum bağlantısı token'ının tam URL ile kaydedilmesi.
