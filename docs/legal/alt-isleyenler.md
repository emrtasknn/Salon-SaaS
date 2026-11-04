# Alt İşleyenler Listesi (Veri İşleme Sözleşmesi Ek-2) — TASLAK

> **Durum:** TASLAK `v0.1` · 2026-11-04 · **Avukat onayı bekliyor.** Değişiklikler sözleşmenin §7.2 maddesine göre salonlara **15 gün önceden** bildirilir.
> `[DOĞRULANACAK]` ile işaretli alanlar sahip tarafından hesap ve panel ayarlarından doldurulmalıdır. Sözleşme tarafı şirket unvanı, hesabın hangi kuruluşla açıldığına bağlıdır.

| Alt işleyen | Hizmet | İşlenen veri | Veri konumu | Yurt dışı aktarım |
|---|---|---|---|---|
| **Supabase, Inc.** (altyapı: AWS) | Veri tabanı (PostgreSQL), kimlik doğrulama, yedekler | Ek-1'deki tüm veriler | [DOĞRULANACAK: proje bölgesi, örn. AB/Frankfurt] | Evet |
| **Vercel Inc.** | Uygulamanın barındırılması ve çalıştırılması (sunucu fonksiyonları), istek logları | İstek sırasında geçen tüm veriler; platform istek logları (IP, tarayıcı bilgisi, durum bağlantısı token'ı dahil tam URL — **maskelenmez**); uygulama logları (telefon, e-posta ve gizli değerler maskeli; müşteri adı maskelenmez) | [DOĞRULANACAK: fonksiyon bölgesi; edge ağı küresel] | Evet |
| **Meta Platforms** (WhatsApp Business Cloud API) | Randevu bilgilendirme mesajlarının iletimi | Alıcılar: müşteri, personel ve salon yöneticisi telefon numaraları. İçerik — müşteriye: hizmet, tarih/saat, personel adı; personel/yöneticiye: müşteri adı, hizmet, tarih/saat. Teslim durumu. *(Salon adı bugün şablonlarda yok — bkz. `whatsapp-izin-metni.md`)* | Küresel [DOĞRULANACAK: sözleşme tarafı Meta Platforms Ireland Ltd. mi, Inc. mi] | Evet |
| **Tarayıcı push hizmetleri** (Google FCM, Mozilla Push Service, Apple Push Notification service) | Çalışan cihazlarına Web Push iletimi | Abonelik uç noktası; içerik **uçtan uca şifreli**, hizmet sağlayıcı okuyamaz | Küresel | Evet [AVUKAT: içeriği okuyamayan iletim hizmetinin alt işleyen sayılıp sayılmadığı] |

**Listede olmayanlar ve nedeni**
- **GitHub (CI):** Testler izole, geçici bir veri tabanında sahte verilerle çalışır; gerçek kişisel veri işlenmez.
- **E-posta gönderim sağlayıcısı:** Müşterilere e-posta gönderilmiyor. Supabase Auth'un çalışanlara giden giriş e-postaları Supabase kapsamındadır. [DOĞRULANACAK: özel SMTP kullanılıyorsa eklenecek]
- **İzleme/hata takibi aracı:** WP-12'de seçilmedi. Seçilirse eklenecek ve 15 gün kuralı uygulanacak.
