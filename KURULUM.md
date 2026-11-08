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
4. Bilgisayarınızda `supabase/migrations/001_schema.sql` dosyasını Not Defteri ile açın. Tümünü seçip (Ctrl+A) kopyalayın (Ctrl+C).
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
4. Ayıkladığınız klasörün **içindekileri** sürükleyip sayfaya bırakın: `index.html`, `config.js`, `js` klasörü, `supabase` klasörü vb. Klasörün kendisini değil, içindekileri bırakın.
   - Klasörlerin de yüklenmesi için Chrome veya Edge kullanın ve sürükle-bırak yapın. "choose your files" penceresi klasör yüklemez.
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

## Bilinen sınırlar

- **Şifremi unuttum:** Supabase'in kendi e-posta servisi yalnızca Supabase hesabınızın ekibindeki adreslere posta gönderir, saatte de çok az e-posta gönderir. Bu yüzden 2. aşamada Resend bağlanana kadar bu bağlantı Hakan'a ulaşmayabilir. O zamana kadar şifresini unutan kişiyi **Authentication → Users** ekranında silip aynı e-postayla yeniden ekleyin (B adımı). Profili, rolü ve görevleri etkilenmez; yeni hesap profile kendiliğinden bağlanır.
- **Giriş hataları:** Güvenlik gereği Supabase "kullanıcı yok" ile "şifre hatalı"yı ayırt etmez. İkisinde de "E-posta veya şifre hatalı" yazar.
- **iPhone:** Bildirimler ve iPhone kurulum ekranı 2. aşamada gelecek.
