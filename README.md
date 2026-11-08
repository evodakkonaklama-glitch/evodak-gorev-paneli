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
| 2 | Bildirimler (uygulama kapalıyken) | ⏳ |
| 3 | Görev ekranları, Kanban, otomatik kayıt, Realtime | ⏳ |
| 4 | Dosyalar | ⏳ |
| 5 | Tekrarlayan görevler, günlük özet, Bugün, Takvim, Projeler | ⏳ |
| 6 | Roller, şablonlar, dışa aktarma, yedek, PWA | ⏳ |

## Klasörler

```
index.html, styles.css, config.js, i18n.js, xlsx.full.min.js
js/            main.js, supabase.js, ui.js, dates.js, excel-format.js, views/
supabase/      migrations/*.sql (SQL Editor'de sırayla çalıştırılır)
```
