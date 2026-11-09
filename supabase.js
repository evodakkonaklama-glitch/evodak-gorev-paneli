// Supabase istemcisi, yapılandırma kontrolü ve hata mesajları
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import { CONFIG } from './config.js';
import { t } from './i18n.js';

// Adresin sonuna yanlışlıkla eklenen /rest/v1/ gibi kısımları atar: https://xxxx.supabase.co
function baseUrl() {
  const m = String(CONFIG.SUPABASE_URL || '').trim().match(/^https:\/\/[a-z0-9-]+\.supabase\.co/i);
  return m ? m[0] : '';
}

export const SUPABASE_BASE = baseUrl();
export const SUPABASE_KEY = String(CONFIG.SUPABASE_ANON_KEY || '').trim();

// 'missing' | 'invalid' | null
export function configProblem() {
  const url = String(CONFIG.SUPABASE_URL || '').trim();
  const key = String(CONFIG.SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) return 'missing';
  if (!baseUrl()) return 'invalid';
  return null;
}

export const supabase = configProblem() ? null : createClient(baseUrl(), String(CONFIG.SUPABASE_ANON_KEY).trim(), {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'evodak.auth' },
});

// Supabase hatasını anlaşılır Türkçe/İngilizce metne çevirir
export function friendlyError(error) {
  if (!error) return '';
  const code = error.code || '';
  const msg = String(error.message || error);
  if (!navigator.onLine || error.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed/i.test(msg)) {
    return t('auth.network');
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return t('auth.invalid_credentials');
  if (code === 'email_not_confirmed') return t('auth.email_not_confirmed');
  if (code === 'user_not_found') return t('auth.user_not_found');
  if (error.status === 429 || /rate limit|too many/i.test(msg) || code.startsWith('over_')) return t('auth.rate_limit');
  if (code === 'weak_password') return t('auth.weak_password');
  if (code === 'same_password') return t('auth.same_password');
  if (code === 'otp_expired' || /expired/i.test(msg)) return t('auth.link_expired');
  return t('auth.unknown', { msg });
}

// 1000 satır sınırına takılmadan tüm satırları sayfa sayfa getirir
export async function fetchAll(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

export async function loadMyProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
