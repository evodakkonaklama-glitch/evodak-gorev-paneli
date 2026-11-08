// =====================================================================
// Paneldeki TEK düzenlenecek dosya.
// Değerleri Supabase > Project Settings ekranından kopyalayıp tırnakların içine yapıştırın.
// Buradaki anahtarlar herkese açık olabilir; gizli anahtarlar (service_role, VAPID özel,
// Resend) buraya ASLA yazılmaz.
// =====================================================================
export const CONFIG = {
  // Örnek biçim: https://abcdefghijkl.supabase.co
  SUPABASE_URL: 'https://znmeghdcyrarfpkuxtvp.supabase.co/rest/v1/',
  // "Publishable key" (sb_publishable_ ile başlar) veya eski "anon public" anahtarı
  SUPABASE_ANON_KEY: 'sb_publishable_eRXjy8MMFBk_k_AL1H4koQ_jHdJX9NU',
  // 2. aşamada doldurulacak (bildirimler)
  VAPID_PUBLIC_KEY: '',
};
