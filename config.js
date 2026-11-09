// =====================================================================
// Paneldeki TEK düzenlenecek dosya.
// Değerleri Supabase > Project Settings ekranından kopyalayıp tırnakların içine yapıştırın.
// Buradaki anahtarlar herkese açık olabilir; gizli anahtarlar (service_role, VAPID özel,
// Resend) buraya ASLA yazılmaz.
// =====================================================================
export const CONFIG = {
  // Örnek biçim: https://abcdefghijkl.supabase.co
  SUPABASE_URL: 'https://znmeghdcyrarfpkuxtvp.supabase.co',
  // "Publishable key" (sb_publishable_ ile başlar) veya eski "anon public" anahtarı
  SUPABASE_ANON_KEY: 'sb_publishable_eRXjy8MMFBk_k_AL1H4koQ_jHdJX9NU',
  // Bildirim (Web Push) genel anahtarı – gizli değildir
  VAPID_PUBLIC_KEY: 'BGwuaSYj3cetkqxfOkM755RS8dRsOhrZeckMyelkrtjLTT4--8tOcRJ3j6Hqe_cjmUXdMK0XHZcC9y8ce37dCg0',
};
