# Evodak Görev Takip Paneli

Evodak'ın tüm projelerinin (Web, Panel, İş Planı) görevlerini tek yerden takip eden, telefona kurulabilen ekip paneli.

- **Arayüz:** HTML + CSS + JavaScript (derleme yok), GitHub Pages
- **Arka uç:** Supabase (PostgreSQL + RLS, Auth, Realtime, Storage, Edge Functions, pg_cron)
- **Dil:** Türkçe / English

Kurulum için **[KURULUM.md](KURULUM.md)** dosyasına bakın. Koddaki tek düzenlenecek dosya `config.js`.

## Durum

| Aşama | İçerik | Durum |
|---|---|---|
| 1 | Veritabanı, giriş, Excel içe aktarma, görev listesi | ✅ |
| 2 | Bildirimler (uygulama kapalıyken) | ✅ |
| 3 | Görev ekranları, Kanban, otomatik kayıt, Realtime | ✅ |
| 4 | Dosyalar | ✅ |
| 5 | Tekrarlayan görevler, günlük özet, Bugün, Takvim, Projeler | ✅ |
| 6 | Kişi ve rol yönetimi, şablonlar ve yeni proje, Excel'e aktarma, haftalık yedek, çöp kutusu, koyu tema, güncelleme uyarısı | ✅ |
| 7 | Listeler, şablon önizleme ve tarih planlama, yorumlar, 4'lü erteleme, öncelikli işler, haftalık özet, yedekten geri yükleme, tüm cihazlardan çıkış, kullanılmama uyarısı | ✅ |
| 8 | Gantt, zaman bloklama, Google ile giriş, Google Tasks | ⏳ |

## Klasörler

Tüm dosyalar deponun ana dizinindedir (GitHub'a sürükle-bırak ile kolay yükleme için alt klasör yoktur).

- Arayüz: index.html, styles.css, config.js, i18n.js, xlsx.full.min.js
- Uygulama: main.js, supabase.js, ui.js, dates.js, excel-format.js, login.js, tasks.js, task-detail.js, import.js, settings.js, today.js, calendar.js, projects.js
- Ek: comments.js (yorumlar), lists.js (listeler), weekly.js (haftalık özet)
- Yönetim: people.js (kişiler), templates.js (şablonlar, yeni proje), export.js (Excel'e aktarma), trash.js (çöp kutusu), backups.js (veri ve yedek)
- Dosyalar: files.js
- Veri katmanı: store.js (otomatik kayıt, çakışma, Realtime), idb.js (çevrimdışı kopya ve kuyruk)
- Bildirim: sw.js, push.js, notify-ui.js, manifest.webmanifest, simgeler (*.png)
- Veritabanı: 001_schema.sql … 008_ek.sql (Supabase SQL Editor'de sırayla çalıştırılır)
- Sunucu (Supabase Edge Functions, JWT doğrulama kapalı): send-reminders.ts, notification-action.ts, manage-users.ts, maintenance.ts

## Güvenlik

- Gizli anahtarlar (service role, VAPID özel anahtarı) yalnızca Supabase'te durur; depoda ve tarayıcıda yoktur. `config.js`'teki anahtar herkese açık (publishable) anahtardır.
- Tüm tablolarda satır düzeyi güvenlik (RLS) açıktır. Dosya ve yedek depoları özeldir; bağlantılar kısa süreli imzalıdır.
- Kişi yönetimi ve kalıcı silme sunucuda rol kontrolüyle yapılır.
