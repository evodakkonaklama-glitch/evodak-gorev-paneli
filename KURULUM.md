# Evodak Görev Paneli – Kurulum Rehberi

Bu rehber teknik bilgi gerektirmez. Terminal kullanmanız gerekmez. Her aşamada yeni bölümler eklenecek.

- **Supabase projesi:** evodak-gorev (Frankfurt)
- **GitHub deposu:** evodak-gorev-paneli
- **Panel adresi:** `https://KULLANICIADINIZ.github.io/evodak-gorev-paneli/`
  (KULLANICIADINIZ = GitHub kullanıcı adınız; depo adresinde `github.com/` sonrasındaki kısımdır.)

---

## 1. AŞAMA – Veritabanı, giriş, yayın ve Excel

Toplam süre yaklaşık 20 dakika. Adımları sırayla yapın.

### A. Supabase: veritabanını kurun (3 dosya)

1. https://supabase.com/dashboard adresine girin, **evodak-gorev** projesini açın.
2. Sol menüde **SQL Editor** simgesine tıklayın.
3. Üstteki **+** (veya **New query**) düğmesine basın; boş bir sorgu sayfası açılır.
4. Bilgisayarınızda `001_schema.sql` dosyasını Not Defteri ile açın. Tümünü seçip (Ctrl+A) kopyalayın (Ctrl+C).
5. Supabase'deki boş sayfaya yapıştırın (Ctrl+V). Sağ alttaki yeşil **Run** düğmesine basın.
   - "Potential issue detected" gibi bir uyarı penceresi çıkarsa **Run this query** deyin.
   - Altta **Success. No rows returned** yazmalı.
6. Yeniden **+ / New query** açın. `002_import.sql` dosyasıyla 4. ve 5. adımı tekrarlayın.
7. Yeniden **+ / New query** açın. `003_seed.sql` dosyasıyla 4. ve 5. adımı tekrarlayın.
   - Altta Hakan ve Gamze'nin olduğu 2 satırlık bir tablo görmelisiniz.

> Bir hata çıkarsa durun. Hata metninin ekran görüntüsünü bana gönderin. Aynı dosyayı ikinci kez çalıştırmayın.

### B. Supabase: Hakan ve Gamze'nin hesaplarını açın

1. Sol menüde **Authentication** → **Users**.
2. Sağ üstte **Add user** → **Create new user**.
3. **Email:** `hkgunsur@gmail.com`. **Password:** en az 8 karakterlik bir şifre.
4. **Auto Confirm User** kutusunun işaretli olduğundan emin olun. **Create user** deyin.
5. Aynısını **Gamze** için yapın. **Email:** `evodak.konaklama@gmail.com`, geçici bir şifre girin.
   - Geçici şifreyi Gamze'ye WhatsApp ile iletin. Gamze ilk girişte **Ayarlar → Şifre değiştir** ile kendi şifresini belirlesin.

Hesaplar e-postalarından profillere kendiliğinden bağlanır, ek bir işlem gerekmez.

### C. Supabase: yabancıların kayıt olmasını kapatın

1. **Authentication** → **Sign In / Providers**.
2. **User Signups** bölümünde **Allow new users to sign up** anahtarını **kapatın**. **Save changes** deyin.
   - Panele yalnızca sizin eklediğiniz kişiler girebilir.

### D. Supabase: panel adresini tanıtın

1. **Authentication** → **URL Configuration**.
2. **Site URL** kutusuna `https://KULLANICIADINIZ.github.io/evodak-gorev-paneli/` yazın. **Save changes** deyin.
3. **Redirect URLs** bölümünde **Add URL**'e basın, `https://KULLANICIADINIZ.github.io/evodak-gorev-paneli/**` yazın. **Save URLs** deyin.

### E. Supabase: iki değeri not alın

1. Sol menünün en altındaki dişli simgesi **Project Settings** → **Data API**.
   - **Project URL** satırındaki adresi kopyalayın (`https://xxxx.supabase.co`).
2. **Project Settings** → **API Keys**.
   - **Publishable key** satırındaki `sb_publishable_...` ile başlayan değeri kopyalayın.
   - Böyle bir anahtar yoksa **Create new API keys** düğmesine basın.
   - Ya da **Legacy API Keys** sekmesindeki **anon public** anahtarını kullanın; ikisi de çalışır.
   - **secret** veya **service_role** anahtarını ASLA kullanmayın.

### F. GitHub: dosyaları yükleyin

1. Size verdiğim zip dosyasını bilgisayarınızda açın (sağ tık → **Tümünü ayıkla**).
2. https://github.com adresinde **evodak-gorev-paneli** deposunu açın.
3. **Add file** → **Upload files**.
4. Ayıkladığınız klasörü açın, içindeki **tüm dosyaları** (Ctrl+A) seçip sayfaya sürükleyin. Panelde alt klasör yoktur; bütün dosyalar deponun ana dizininde durur. Aynı adlı eski dosyaların üzerine yazılır, bu normaldir.
5. Alttaki **Commit changes** düğmesine basın.

### G. GitHub: config.js'i doldurun

1. Depoda **config.js** dosyasına tıklayın, sağ üstteki **kalem simgesine** (Edit this file) basın.
2. `SUPABASE_URL: ''` satırında tırnakların arasına E.1'deki adresi yapıştırın.
3. `SUPABASE_ANON_KEY: ''` satırında tırnakların arasına E.2'deki anahtarı yapıştırın.
   - Örnek: `SUPABASE_URL: 'https://abcd1234.supabase.co',`
4. Sağ üstte **Commit changes...** → açılan pencerede yine **Commit changes**.

### H. GitHub Pages'i açın

1. Depo **public** (herkese açık) olmalı. Ücretsiz GitHub'da Pages yalnızca public depolarda çalışır.
   - Depoda gizli bilgi yok; tarayıcı anahtarı zaten herkese açık olacak şekilde tasarlandı ve veriler giriş ile korunuyor.
   - Depo private ise: **Settings** → en altta **Danger Zone** → **Change visibility** → **Make public**.
2. **Settings** → sol menüde **Pages**.
3. **Build and deployment** → **Source**: **Deploy from a branch**.
4. **Branch**: **main**, klasör **/ (root)**. **Save** deyin.
5. 1–2 dakika bekleyip sayfayı yenileyin. Üstte "Your site is live at …" yazar; bağlantıya tıklayın.

### I. İlk giriş ve Excel yükleme

1. Panel adresini açın. `hkgunsur@gmail.com` ve B adımındaki şifreyle giriş yapın.
2. "Henüz görev yok" ekranında **Excel listesini yükle** düğmesine basın.
3. **Evodak_Gorev_Paneli_18_Sutun.xlsx** dosyasını seçin. Önizlemede şunları görmelisiniz:
   - **588 Eklenecek**, **0 Hatalı**
   - **1243 Kontrol maddesi**, **21 Proje**, **67 Şablon adımı**
4. **588 görevi içe aktar** düğmesine basın. Birkaç saniye sonra "İçe aktarma tamamlandı" yazar.
5. **Görevlere git** ile listeyi açın.

---

## 2. AŞAMA – Bildirimler (uygulama kapalıyken de)

Toplam süre yaklaşık 30 dakika; DNS doğrulaması ayrıca birkaç saat sürebilir. Sırayla yapın. Gizli değerler (VAPID özel anahtarı, Resend anahtarı) bu dosyada **yoktur**; yalnızca Supabase'e girilir.

### A. Resend: API anahtarı alın

1. https://resend.com adresine `evodak.konaklama@gmail.com` hesabıyla girin.
2. Sol menüde **API Keys** → **Create API Key**.
3. **Name:** `evodak-panel`. **Permission:** **Sending access**. **Domain:** **All domains**. **Add** deyin.
4. `re_` ile başlayan anahtar **yalnızca bir kez** gösterilir. Kopyalayıp bir yere not edin.

### B. Supabase: gizli değerleri (Secrets) girin

1. Supabase'de **evodak-gorev** → sol menüde **Edge Functions** → **Secrets**.
2. Aşağıdaki 6 değeri tek tek ekleyin. Her biri için **Name** ve **Value** kutusunu doldurun; birden çok satır eklemek için **Add another**'a basın. Sonunda **Save**'e basın.

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | Sohbette verdiğim **genel** anahtar (`BGwu…` ile başlar) |
| `VAPID_PRIVATE_KEY` | Sohbette verdiğim **özel** anahtar. Başka hiçbir yere yazmayın. |
| `VAPID_SUBJECT` | `mailto:evodak.konaklama@gmail.com` |
| `RESEND_API_KEY` | A adımındaki `re_…` anahtarı |
| `MAIL_FROM` | `Evodak Panel <onboarding@resend.dev>` (alan adı doğrulanınca F adımında değişecek) |
| `APP_URL` | `https://evodakkonaklama-glitch.github.io/evodak-gorev-paneli/` |

### C. Supabase: iki Edge Function yükleyin

**send-reminders:**
1. **Edge Functions** → **Functions** → sağ üstte **Deploy a new function** → **Via Editor**.
2. Sol üstteki işlev adını `send-reminders` yapın.
3. Editördeki örnek kodun **tamamını silin**. `send-reminders.ts` dosyasının tamamını yapıştırın.
4. Alttaki **Deploy function**'a basın; 10–30 saniye sürer.
5. Açılan işlev sayfasında **Details** (veya **Settings**) sekmesine geçin. **Enforce JWT verification** (Verify JWT) anahtarını **kapatın** ve **Save changes** deyin.
   - Bu işlevi her dakika zamanlayıcı çağırır; güvenliği kod içindeki ayrı bir şifre sağlar.

**notification-action:**
6. Aynı adımları `notification-action` adıyla ve `notification-action.ts` dosyasıyla yapın. **Enforce JWT verification** bunda da **kapalı** olmalı.
   - Bildirimdeki düğmeler bu işlevi oturumsuz çağırır; güvenliği tek kullanımlık şifreli token sağlar.

### D. Supabase: zamanlayıcıyı kurun

1. **SQL Editor** → **Yeni bir kod parçacığı oluşturun**.
2. `004_bildirim.sql` dosyasının tamamını yapıştırın, **Run** deyin.
3. Altta 2 satır görmelisiniz: `cleanup-notifications` ve `send-reminders`.
   - "extension not available" gibi bir hata alırsanız: **Database** → **Extensions** ekranında **pg_cron** ve **pg_net**'i açın, sonra dosyayı yeniden çalıştırın.

### E. GitHub: yeni dosyaları yükleyin

1. Zip'i ayıklayın, içindeki **tüm dosyaları** seçip deponuza **Add file → Upload files** ile sürükleyin. **Commit changes** deyin.
   - Yeni dosyalar: `sw.js`, `push.js`, `notify-ui.js`, `manifest.webmanifest`, 5 simge (`.png`), `004_bildirim.sql`, `send-reminders.ts`, `notification-action.ts`.
   - `config.js` bildirim anahtarıyla güncellendi; düzenlemenize gerek yok.
2. 1–2 dakika sonra paneli açın. Sayfayı bir kez yenileyin (bilgisayarda Ctrl+F5).

### F. ~~Resend: alan adını doğrulayın~~ — İPTAL (09.11.2026)

> Kullanıcı kararıyla e-posta bildirimi kullanılmıyor. Bu adımı atlayın. Supabase Secrets'tan `RESEND_API_KEY` ve `MAIL_FROM` silinir; SQL: `update public.profiles set email_notifications = false;`

<details><summary>Eski adımlar (ileride e-posta istenirse)</summary>


O zamana kadar e-posta yedeği yalnızca `evodak.konaklama@gmail.com` adresine gidebilir; panel yine de çalışır.

1. Resend → **Domains** → **bildirim.evodak.com**. Ekranda 3 kayıt görünür (MX, TXT SPF, TXT DKIM).
2. evodak.com alan adınızı aldığınız firmanın paneline girin → **DNS Yönetimi**. Her kaydı Resend'deki değerle ekleyin:

| Tür | Ad / Host (firma paneline yazılacak) | Değer | Öncelik |
|---|---|---|---|
| MX | `send.bildirim` | Resend'deki MX değeri (`feedback-smtp…amazonses.com`) | 10 |
| TXT | `send.bildirim` | `v=spf1 include:amazonses.com ~all` | – |
| TXT | `resend._domainkey.bildirim` | Resend'deki uzun `p=…` değeri (kopyala simgesiyle) | – |

   - Ad kutusuna `.evodak.com` kısmını **yazmayın**; panel kendisi ekler.
3. Resend'de **Verify DNS Records**'a basın. Birkaç dakika ile birkaç saat arasında **Verified** olur.
4. Doğrulanınca:
   - Supabase → **Edge Functions → Secrets**'ta `MAIL_FROM` değerini `Evodak Panel <panel@bildirim.evodak.com>` yapın.
   - Supabase → **Authentication** → **Emails** → **SMTP Settings** → **Enable custom SMTP**'yi açın:
     - **Sender email:** `panel@bildirim.evodak.com`
     - **Sender name:** `Evodak Panel`
     - **Host:** `smtp.resend.com`
     - **Port:** `465`
     - **Username:** `resend`
     - **Password:** Resend API anahtarı
     - **Save** deyin. Bundan sonra "Şifremi unuttum" herkese çalışır.

</details>

### G. Cihazlarda bildirimleri açın

**iPhone (iOS 16.4 veya üstü):**
1. Paneli **Safari**'de açın → alttaki **Paylaş** simgesi → **Ana Ekrana Ekle** → **Ekle**.
2. Ana ekrandaki **Evodak** simgesinden açın, giriş yapın.
3. Çıkan pencerede **Bildirimleri aç** → **İzin Ver**.

**Bilgisayar (Windows, Chrome veya Edge):**
1. Paneli açın, giriş yapın, **Bildirimleri aç** → **İzin ver**.
2. Adres çubuğunun sağındaki **Uygulamayı yükle** simgesiyle paneli uygulama olarak kurun (isteğe bağlı).
3. Tarayıcı tamamen kapalıyken de bildirim gelmesi için:
   - **Chrome:** Ayarlar → **Sistem** → **Google Chrome kapatıldığında arka plan uygulamalarını çalıştırmaya devam et** açık olmalı.
   - **Edge:** Ayarlar → **Sistem ve performans** → **Microsoft Edge kapatıldığında arka plan uzantılarını ve uygulamalarını çalıştırmaya devam et** açık olmalı.
4. Windows → Ayarlar → **Sistem** → **Bildirimler**'de Chrome/Edge açık olmalı.

**Mac:** Safari'de paneli açın → **Dosya** → **Dock'a Ekle**. Dock'taki Evodak'tan açıp bildirimleri açın. Safari'nin Dock uygulaması, Safari kapalıyken de bildirim alır. Mac'te Chrome kapalıyken bildirim gelmez.

Sonra her cihazda **Ayarlar → Bildirimler → Test bildirimi gönder**. Birkaç saniye içinde sistem bildirimi gelmeli.

### H. Bildirim kabul testi (zorunlu)

Sessiz saatler (22:00–08:00) içinde test yapmayın. Bu saatlerdeki bildirimler sabaha ertelenir. Gerekirse test süresince **Ayarlar → Bildirimler**'de sessiz saat kutularını temizleyin.

1. iPhone'da paneli kapatın (uygulama değiştiriciden yukarı kaydırın). Bilgisayarda tarayıcıyı tamamen kapatın.
2. Başka bir cihazdan Supabase → **SQL Editor** → **Yeni bir kod parçacığı** açın. Aşağıdakini yapıştırıp **Run** deyin. 2 dakika sonrası için hatırlatmalı bir test görevi kurar:

```sql
insert into public.tasks (no, project_id, section, title, due_date, due_time, reminder)
select 9001, id, 'Test', 'Bildirim kabul testi',
       (now() at time zone 'Europe/Istanbul')::date,
       ((now() at time zone 'Europe/Istanbul') + interval '2 minutes')::time(0), 'at_time'
from public.projects order by sort_order limit 1
on conflict (no) do update set status = 'todo', deleted_at = null,
  due_date = excluded.due_date, due_time = excluded.due_time, reminder = 'at_time';
```

3. 2–3 dakika içinde iPhone'a ve bilgisayara **"Bildirim kabul testi"** bildirimi gelmeli.
4. Bildirimdeki **Tamamlandı** düğmesine basın. "Tamamlandı olarak işaretlendi ✓" yazmalı.
   - iPhone düğmeleri göstermezse bildirime dokunun. Panel görevi açar; oradaki **Tamamlandı**'ya basın.
5. 5 dakika bekleyin: aynı bildirim **ikinci kez gelmemeli**.
6. Durumu görmek için SQL Editor'de:

```sql
select p.full_name, l.channel, l.status, l.attempts, l.last_error,
       l.sent_at at time zone 'Europe/Istanbul' as gonderim
from public.notification_log l join public.profiles p on p.id = l.profile_id
order by l.created_at desc limit 10;
```

7. Test bitince test görevini silin: `delete from public.tasks where no = 9001;`

---

## 3. AŞAMA – Görev ekranları

Bu aşamada Supabase'de yapılacak bir şey **yok**. Yalnızca GitHub'a dosya yüklenir.

### A. GitHub: dosyaları yükleyin
1. `evodak-gorev-paneli-asama3.zip` dosyasını ayıklayın.
2. GitHub → **evodak-gorev-paneli** → **Add file → Upload files** → klasördeki **tüm dosyaları** (Ctrl+A) sürükleyin → **Commit changes**.
   - Yeni dosyalar: `store.js`, `idb.js`, `task-detail.js`. Diğerleri güncellendi.
3. 1–2 dakika sonra paneli açın ve **bir kez yenileyin**: bilgisayarda Ctrl+F5, iPhone'da paneli kapatıp yeniden açın.

### B. Deneyin
- **Liste/Kanban:** Görevler ekranında sağ üstteki iki düğmeyle görünüm değişir. Kanban'da kartı başka sütuna sürükleyince durum değişir.
- **Hızlı görünümler:** Tümü · Bugün · Geciken · Bana atanan · Tamamlanan (sayılarıyla).
- **Filtreler:** Proje, bölüm, kategori, durum, öncelik, sorumlu, etiket, bitiş tarihi aralığı. Sütun başlığına tıklayınca o sütuna göre sıralanır.
- **Görev detayı:** Bir göreve tıklayın; sağdan panel açılır (telefonda tam ekran). Her alan **kendiliğinden kaydedilir**. Sağ üstte "Kaydediliyor… → Kaydedildi" görünür.
- **Kontrol listesi:** Madde tikleyin, ekleyin, silin, ↑↓ ile ya da sürükleyerek sıralayın. İlerleme ve durum kendiliğinden değişir.
- **Değişiklik geçmişi:** Detayın altında kim, ne zaman, neyi değiştirdi (eski → yeni).
- **İki kişi aynı anda:** Gamze bir görevi değiştirdiğinde Hakan'ın ekranında birkaç saniye içinde görünür. İkisi aynı alanı aynı anda değiştirirse "Çakışma" uyarısı çıkar ve hangisinin kalacağı sorulur.
- **Çevrimdışı:** İnternet yokken panel açılır, görevler okunur ve düzenlenir. Sağ üstte "Çevrimdışı, bağlanınca gönderilecek" yazar; bağlanınca değişiklikler sırayla gönderilir.
- **Yeni görev:** "+ Yeni görev" (telefonda sağ alttaki büyük + düğmesi). **Sil:** onaylı; 8 saniye boyunca "Geri al" çıkar.

---

## Bilinen sınırlar

- **Şifremi unuttum:** Supabase'in kendi e-posta servisi yalnızca Supabase hesabınızın ekibindeki adreslere posta gönderir, saatte de çok az e-posta gönderir. Bu yüzden 2. aşama F adımı (Resend SMTP) yapılana kadar bu bağlantı Hakan'a ulaşmayabilir. O zamana kadar şifresini unutan kişiyi **Authentication → Users** ekranında silip aynı e-postayla yeniden ekleyin (B adımı). Profili, rolü ve görevleri etkilenmez; yeni hesap profile kendiliğinden bağlanır.
- **Giriş hataları:** Güvenlik gereği Supabase "kullanıcı yok" ile "şifre hatalı"yı ayırt etmez. İkisinde de "E-posta veya şifre hatalı" yazar.
- **iPhone:** Bildirim için iOS 16.4 veya üstü ve **Ana Ekrana Ekle** ile kurulum gerekir. Safari sekmesinde açılan panel bildirim alamaz.
- **Bilgisayar:** Windows'ta Chrome/Edge'in "kapatıldığında arka planda çalışmaya devam et" ayarı açık olmalı. Mac'te Safari'nin "Dock'a Ekle" uygulaması kullanılmalı.
- **Supabase ücretsiz planı:** Proje 7 gün hiç kullanılmazsa duraklatılır; bu sürede bildirim gitmez. Panel her gün kullanılıyorsa sorun olmaz. Kesintisizlik için Pro plan (aylık 25 $) önerilir.
- **E-posta:** Resend ücretsiz planı günde 100, ayda 3.000 e-postaya izin verir. Alan adı doğrulanana kadar e-posta yalnızca evodak.konaklama@gmail.com adresine gider.
- **Hatırlatma zamanı:** Sunucu her dakika kontrol eder; bildirim zamanından en geç 1–2 dakika sonra gelir. Sunucu 60 dakikadan uzun süre çalışamazsa, o aralıkta kaçan hatırlatmalar sonradan gönderilmez.
