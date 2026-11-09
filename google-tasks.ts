// =====================================================================
// Evodak Görev Paneli – Edge Function: google-tasks
// Supabase > Edge Functions'a "google-tasks" adıyla yüklenir (JWT doğrulama KAPALI).
// Gizli değerler (Edge Function Secrets): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//
// Ne yapar?
//  - Kişinin kendisine ATANMIŞ açık görevlerini Google Tasks'ta "Evodak Görevleri" listesine yazar
//    (başlık, bitiş tarihi, proje ve panel bağlantısı). Panelde değişince Google'da da güncellenir.
//  - Google Tasks'ta "tamamlandı" işaretlenen görev panelde de tamamlanır (tekrarlayan görev sıradaki
//    tekrara geçer ve Google'da yeniden açılır).
//  - Panelde tamamlanan görev Google'da tamamlanır; silinen/başkasına atanan görev Google'dan kaldırılır.
//
// Çağrılar:
//   { action: 'auth_url' }               (oturumlu)  Google izin sayfasının adresi
//   { action: 'exchange', code, state }  (oturumlu)  izin sonrası bağlantıyı kaydet + ilk eşitleme
//   { action: 'sync' }                   (oturumlu)  şimdi eşitle
//   { action: 'disconnect' }             (oturumlu)  bağlantıyı kaldır
//   { mode: 'cron' }                     (x-cron-secret)  her 15 dakikada tüm bağlı kişiler
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://evodakkonaklama-glitch.github.io/evodak-gorev-paneli/').replace(/\/?$/, '/');
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const AUTH_URL = Deno.env.get('GOOGLE_AUTH_URL') ?? 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = Deno.env.get('GOOGLE_TOKEN_URL') ?? 'https://oauth2.googleapis.com/token';
const REVOKE_URL = Deno.env.get('GOOGLE_REVOKE_URL') ?? 'https://oauth2.googleapis.com/revoke';
const API = Deno.env.get('GOOGLE_API_BASE') ?? 'https://tasks.googleapis.com/tasks/v1';
const REDIRECT_URI = `${APP_URL}google.html`;
const SCOPES = 'openid email https://www.googleapis.com/auth/tasks';
const LIST_TITLE = 'Evodak Görevleri';
const MAX_OPS = 200;   // tek eşitlemede en fazla Google isteği (kota için)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function serviceKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try { const k = JSON.parse(keys); if (k.default) return k.default; } catch { /* eski anahtara düş */ }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}
const db = createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// ---------------------------------------------------------------- imzalı "state" (izin sayfası dönüşünü doğrular)
const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function hmac(text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${CLIENT_SECRET}:evodak-state`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))));
}
async function makeState(profileId: string) {
  const body = b64u(new TextEncoder().encode(JSON.stringify({ p: profileId, t: Date.now() })));
  return `${body}.${await hmac(body)}`;
}
async function readState(state: string): Promise<string | null> {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig || sig !== await hmac(body)) return null;
  try {
    const o = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (Date.now() - Number(o.t) > 20 * 60000) return null;   // 20 dakikadan eski izin dönüşü geçersiz
    return String(o.p);
  } catch { return null; }
}

// ---------------------------------------------------------------- Google çağrıları
async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

type Ctx = { token: string; ops: number };
async function gapi(ctx: Ctx, method: string, path: string, body?: unknown) {
  ctx.ops++;
  const res = await fetch(`${API}${path}`, {
    method, headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return { status: 204, data: null };
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function emailFromIdToken(idToken?: string) {
  try { return JSON.parse(atob(String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email ?? null; } catch { return null; }
}

// ---------------------------------------------------------------- eşitleme
// deno-lint-ignore no-explicit-any
type Task = Record<string, any>;

function gTaskBody(t: Task, projects: Map<string, string>) {
  const proj = projects.get(t.project_id) ?? '';
  return {
    title: t.title,
    notes: `${[proj, t.section].filter(Boolean).join(' · ')}\n${APP_URL}#/gorev/${t.id}`,
    due: t.due_date ? `${t.due_date}T00:00:00.000Z` : null,
    status: t.status === 'done' ? 'completed' : 'needsAction',
  };
}

async function syncProfile(profileId: string) {
  const { data: tok } = await db.from('google_tokens').select('refresh_token').eq('profile_id', profileId).maybeSingle();
  const { data: conn } = await db.from('google_connections').select('*').eq('profile_id', profileId).maybeSingle();
  if (!tok || !conn) return { ok: false, error: 'not_connected' };

  const fail = async (error: string) => {
    await db.from('google_connections').update({ last_error: error, updated_at: new Date().toISOString() }).eq('profile_id', profileId);
    return { ok: false, error };
  };

  const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token });
  if (!r.ok) return fail(r.data?.error === 'invalid_grant' ? 'reconnect' : `token: ${r.data?.error ?? 'error'}`);
  const ctx: Ctx = { token: r.data.access_token, ops: 0 };

  // 1) Liste
  let listId = conn.tasklist_id as string | null;
  if (listId) {
    const g = await gapi(ctx, 'GET', `/users/@me/lists/${encodeURIComponent(listId)}`);
    if (g.status === 404) listId = null;
    else if (g.status >= 400) return fail(`list: ${g.status}`);
  }
  if (!listId) {   // daha önce oluşturulmuş "Evodak Görevleri" listesi varsa onu kullan
    const all = await gapi(ctx, 'GET', '/users/@me/lists?maxResults=100');
    listId = (all.data?.items ?? []).find((x: Task) => x.title === LIST_TITLE)?.id ?? null;
  }
  if (!listId) {
    const g = await gapi(ctx, 'POST', '/users/@me/lists', { title: LIST_TITLE });
    if (g.status >= 400) return fail(`list_create: ${g.status}`);
    listId = g.data.id;
  }
  if (listId !== conn.tasklist_id) await db.from('google_task_links').delete().eq('profile_id', profileId);   // liste değişti: eski eşlemeler geçersiz
  const L = `/lists/${encodeURIComponent(listId!)}`;

  // 2) Eşlemeler ve panel görevleri
  const { data: links } = await db.from('google_task_links').select('task_id,google_task_id,synced_version').eq('profile_id', profileId);
  const linkMap = new Map((links ?? []).map((l) => [l.task_id, l]));
  const cols = 'id,title,section,project_id,due_date,status,assignee_id,deleted_at,version,recurrence';
  const { data: mine } = await db.from('tasks').select(cols).eq('assignee_id', profileId).is('deleted_at', null).not('status', 'in', '(done,cancelled)').limit(1000);
  const linkedIds = [...linkMap.keys()];
  const linked: Task[] = [];
  for (let i = 0; i < linkedIds.length; i += 200) {
    const { data } = await db.from('tasks').select(cols).in('id', linkedIds.slice(i, i + 200));
    linked.push(...(data ?? []));
  }
  const byId = new Map<string, Task>([...linked, ...(mine ?? [])].map((t) => [t.id, t]));
  const { data: projRows } = await db.from('projects').select('id,name');
  const projects = new Map((projRows ?? []).map((p) => [p.id, p.name]));

  // 3) Google -> panel: Google'da tamamlanan görevi panelde tamamla
  let completedFromGoogle = 0;
  const gByTask = new Map<string, Task>();
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ showCompleted: 'true', showHidden: 'true', maxResults: '100' });
    if (pageToken) qs.set('pageToken', pageToken);
    const g = await gapi(ctx, 'GET', `${L}/tasks?${qs}`);
    if (g.status >= 400) return fail(`list_tasks: ${g.status}`);
    for (const it of g.data?.items ?? []) {
      let link = [...linkMap.values()].find((l) => l.google_task_id === it.id);
      // Eşlemesi olmayan ama notunda panel bağlantısı olan görev (ör. yeniden bağlanınca): sahiplen, kopya oluşturma
      const m = !link && it.status !== 'completed' ? String(it.notes ?? '').match(/#\/gorev\/([0-9a-f-]{36})/) : null;
      if (m && byId.has(m[1]) && !linkMap.has(m[1])) {
        link = { task_id: m[1], google_task_id: it.id, synced_version: null };
        linkMap.set(m[1], link);
        await db.from('google_task_links').upsert({ profile_id: profileId, task_id: m[1], google_task_id: it.id, synced_version: null });
      }
      if (link) gByTask.set(link.task_id, it);
    }
    pageToken = g.data?.nextPageToken ?? '';
  } while (pageToken && ctx.ops < MAX_OPS);

  for (const [taskId, link] of linkMap) {
    const g = gByTask.get(taskId);
    const t = byId.get(taskId);
    if (!g) {   // Google'da silinmiş: eşlemeyi kaldır (görev hâlâ açıksa aşağıda yeniden eklenir)
      await db.from('google_task_links').delete().eq('profile_id', profileId).eq('task_id', taskId);
      linkMap.delete(taskId);
      continue;
    }
    if (g.status === 'completed' && t && !t.deleted_at && !['done', 'cancelled'].includes(t.status) && t.assignee_id === profileId) {
      const { data: res } = await db.rpc('gtasks_complete', { p_task: taskId, p_profile: profileId });
      if (res === 'done' || res === 'recurring') completedFromGoogle++;
      const { data: fresh } = await db.from('tasks').select(cols).eq('id', taskId).maybeSingle();
      if (fresh) byId.set(taskId, fresh);
      if (res === 'done') {   // Google'da zaten tamamlandı: eşlemeyi bırak (Google'daki görev "tamamlandı" olarak kalır)
        await db.from('google_task_links').delete().eq('profile_id', profileId).eq('task_id', taskId);
        linkMap.delete(taskId);
        byId.delete(taskId);
      }
    }
  }

  // 4) Panel -> Google
  let pushed = 0;
  for (const t of byId.values()) {
    if (ctx.ops >= MAX_OPS) break;
    const link = linkMap.get(t.id);
    const active = !t.deleted_at && t.assignee_id === profileId && t.status !== 'cancelled';
    if (!active) {
      if (link) {
        await gapi(ctx, 'DELETE', `${L}/tasks/${encodeURIComponent(link.google_task_id)}`);
        await db.from('google_task_links').delete().eq('profile_id', profileId).eq('task_id', t.id);
        pushed++;
      }
      continue;
    }
    if (!link) {
      if (t.status === 'done') continue;   // tamamlanmış ve hiç eşlenmemiş: gönderme
      const g = await gapi(ctx, 'POST', `${L}/tasks`, gTaskBody(t, projects));
      if (g.status < 400) {
        await db.from('google_task_links').upsert({ profile_id: profileId, task_id: t.id, google_task_id: g.data.id, synced_version: t.version, synced_at: new Date().toISOString() });
        pushed++;
      }
    } else if (link.synced_version !== t.version || t.status === 'done') {
      const g = await gapi(ctx, 'PATCH', `${L}/tasks/${encodeURIComponent(link.google_task_id)}`, gTaskBody(t, projects));
      if (g.status < 400) {
        if (t.status === 'done') {   // panelde tamamlandı: Google'da tamamlandı yapıldı, eşleme bırakılır
          await db.from('google_task_links').delete().eq('profile_id', profileId).eq('task_id', t.id);
        } else {
          await db.from('google_task_links').update({ synced_version: t.version, synced_at: new Date().toISOString() }).eq('profile_id', profileId).eq('task_id', t.id);
        }
        pushed++;
      }
    }
  }

  const { count } = await db.from('google_task_links').select('task_id', { count: 'exact', head: true }).eq('profile_id', profileId);
  await db.from('google_connections').update({
    tasklist_id: listId, last_sync_at: new Date().toISOString(), last_error: null, synced_count: count ?? 0, updated_at: new Date().toISOString(),
  }).eq('profile_id', profileId);
  return { ok: true, pushed, completed_from_google: completedFromGoogle, linked: count ?? 0, requests: ctx.ops };
}

// ---------------------------------------------------------------- giriş
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.mode === 'cron') {
      const { data: ok } = await db.rpc('check_cron_secret', { s: req.headers.get('x-cron-secret') ?? '' });
      if (!ok) return json({ error: 'unauthorized' }, 401);
      if (!CLIENT_ID || !CLIENT_SECRET) return json({ ok: true, skipped: 'not_configured' });
      const { data: conns } = await db.from('google_connections').select('profile_id').limit(100);
      const results: Record<string, unknown> = {};
      for (const c of conns ?? []) results[c.profile_id] = await syncProfile(c.profile_id).catch((e) => ({ ok: false, error: String(e) }));
      return json({ ok: true, results });
    }

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u, error } = await db.auth.getUser(jwt);
    if (error || !u?.user) return json({ ok: false, error: 'unauthorized' }, 401);
    const { data: me } = await db.from('profiles').select('id,role,active').eq('user_id', u.user.id).maybeSingle();
    if (!me?.active || !['owner', 'admin', 'member'].includes(me.role)) return json({ ok: false, error: 'forbidden' }, 403);
    if (!CLIENT_ID || !CLIENT_SECRET) return json({ ok: false, error: 'not_configured' }, 400);

    if (body.action === 'auth_url') {
      const qs = new URLSearchParams({
        client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES,
        access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: await makeState(me.id),
      });
      return json({ ok: true, url: `${AUTH_URL}?${qs}` });
    }

    if (body.action === 'exchange') {
      const pid = await readState(body.state);
      if (!pid || pid !== me.id) return json({ ok: false, error: 'bad_state' }, 400);
      const r = await tokenRequest({ grant_type: 'authorization_code', code: String(body.code ?? ''), redirect_uri: REDIRECT_URI });
      if (!r.ok) return json({ ok: false, error: `exchange: ${r.data?.error ?? 'error'}` }, 400);
      if (!String(r.data.scope ?? '').includes('auth/tasks')) return json({ ok: false, error: 'scope_missing' }, 400);
      const old = await db.from('google_tokens').select('refresh_token').eq('profile_id', me.id).maybeSingle();
      const refresh = r.data.refresh_token ?? old.data?.refresh_token;
      if (!refresh) return json({ ok: false, error: 'no_refresh_token' }, 400);
      await db.from('google_tokens').upsert({ profile_id: me.id, refresh_token: refresh, updated_at: new Date().toISOString() });
      await db.from('google_connections').upsert({ profile_id: me.id, google_email: emailFromIdToken(r.data.id_token), last_error: null, updated_at: new Date().toISOString() });
      return json({ ...(await syncProfile(me.id)), connected: true });
    }

    if (body.action === 'sync') return json(await syncProfile(me.id));

    if (body.action === 'disconnect') {
      const { data: tok } = await db.from('google_tokens').select('refresh_token').eq('profile_id', me.id).maybeSingle();
      if (tok?.refresh_token) await fetch(`${REVOKE_URL}?token=${encodeURIComponent(tok.refresh_token)}`, { method: 'POST' }).catch(() => null);
      await db.from('google_task_links').delete().eq('profile_id', me.id);
      await db.from('google_tokens').delete().eq('profile_id', me.id);
      await db.from('google_connections').delete().eq('profile_id', me.id);
      return json({ ok: true });
    }
    return json({ ok: false, error: 'bad_action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
