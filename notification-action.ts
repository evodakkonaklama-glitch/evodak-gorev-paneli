// =====================================================================
// Evodak Görev Paneli – Edge Function: notification-action
// Supabase > Edge Functions'a "notification-action" adıyla yüklenir.
// Bildirimdeki "Tamamlandı" ve "10 dk ertele" düğmeleri bu adresi çağırır.
// Oturum gerekmez: bildirime eklenen tek kullanımlık token ile çalışır.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function serviceKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try { const k = JSON.parse(keys); if (k.default) return k.default; } catch { /* eski anahtara düş */ }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  try {
    const { token, action } = await req.json();
    if (typeof token !== 'string' || token.length < 20 || !['done', 'snooze'].includes(action)) {
      return json({ ok: false, error: 'bad_request' }, 400);
    }
    const { data, error } = await db.rpc('use_action_token', { p_hash: await sha256Hex(token), p_action: action });
    if (error) throw error;
    return json(data, data?.ok ? 200 : 409);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
