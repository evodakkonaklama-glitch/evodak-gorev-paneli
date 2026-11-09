// =====================================================================
// Evodak Görev Paneli – Edge Function: maintenance
// Supabase > Edge Functions'a "maintenance" adıyla yüklenir (JWT doğrulama KAPALI).
//   { mode: 'daily' }   pg_cron her gece çağırır (x-cron-secret ile):
//                       30 günü geçen çöpü kalıcı siler, haftada bir yedek alır.
//   { mode: 'backup' }  Ayarlar > Yedekler > "Şimdi yedek al" (owner/admin oturumu)
//   { mode: 'purge', task_ids? }  Çöp kutusu > "Kalıcı sil" / "Çöpü boşalt" (yalnızca owner)
// Yedek: tüm tablolar JSON + görevler Excel (içe aktarma ekranıyla geri yüklenebilir).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import * as XLSX from 'npm:xlsx@0.18.5';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const TRASH_DAYS = 30;
const KEEP_BACKUPS = 12;              // en yeni 12 yedek saklanır (~3 ay)
const WEEK_MS = 6.5 * 86400000;      // "son yedek bir haftadan eski mi?"

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

// 1000 satır sınırını aşmak için sayfa sayfa okur
// deno-lint-ignore no-explicit-any
async function fetchAll(table: string, columns = '*', order = 'created_at'): Promise<any[]> {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order(order).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ---------------------------------------------------------------- kalıcı silme
async function deleteTasks(ids: string[]) {
  let files = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data: att } = await db.from('attachments').select('storage_path').in('task_id', chunk);
    const paths = (att ?? []).map((a) => a.storage_path);
    for (let j = 0; j < paths.length; j += 100) {
      const { error } = await db.storage.from('files').remove(paths.slice(j, j + 100));
      if (error) throw new Error(`files: ${error.message}`);
    }
    files += paths.length;
    const { error } = await db.from('tasks').delete().in('id', chunk).not('deleted_at', 'is', null);
    if (error) throw new Error(`tasks: ${error.message}`);
  }
  return { tasks: ids.length, files };
}

async function purgeOld() {
  const limit = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
  const { data } = await db.from('tasks').select('id').not('deleted_at', 'is', null).lt('deleted_at', limit).limit(1000);
  return deleteTasks((data ?? []).map((x) => x.id));
}

// ---------------------------------------------------------------- Excel (18 sütun, içe aktarmayla aynı biçim)
const L = {
  status: { todo: 'Yapılacak', in_progress: 'Devam ediyor', waiting: 'Bekliyor', blocked: 'Engellendi', done: 'Tamamlandı', cancelled: 'İptal edildi' },
  priority: { urgent: 'Acil', high: 'Yüksek', medium: 'Orta', low: 'Düşük' },
  recurrence: { once: 'Tek sefer', daily: 'Her gün', weekdays: 'Hafta içi her gün', weekly: 'Her hafta', monthly: 'Her ay', yearly: 'Her yıl' },
  reminder: { none: 'Yok', at_time: 'Tam zamanında', '15m': '15 dk önce', '1h': '1 saat önce', '1d': '1 gün önce', '1w': '1 hafta önce' },
  weekday: { mon: 'Pazartesi', tue: 'Salı', wed: 'Çarşamba', thu: 'Perşembe', fri: 'Cuma', sat: 'Cumartesi', sun: 'Pazar' },
  role: { owner: 'Yönetici (owner)', admin: 'Yetkili (admin)', member: 'Üye (member)', viewer: 'İzleyici (viewer)' },
} as Record<string, Record<string, string>>;
const trDate = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

// deno-lint-ignore no-explicit-any
function buildWorkbook(d: Record<string, any[]>) {
  const projects = new Map(d.projects.map((p) => [p.id, p]));
  const people = new Map(d.profiles.map((p) => [p.id, p]));
  // deno-lint-ignore no-explicit-any
  const items = new Map<string, any[]>();
  for (const it of d.checklist_items) { if (!items.has(it.task_id)) items.set(it.task_id, []); items.get(it.task_id)!.push(it); }
  const head = ['NO', 'PROJE', 'BÖLÜM', 'KATEGORİ', 'YAPILMASI GEREKEN', 'AÇIKLAMA', 'ETİKETLER', 'DURUM', 'ÖNCELİK',
    'BİTİRME ORANI', 'SORUMLU KİŞİ', 'BAŞLANGIÇ TARİHİ', 'BİTİRME TARİHİ', 'TAHMİNİ SÜRE (dk)', 'TEKRAR', 'TEKRAR GÜNÜ', 'HATIRLATMA', 'REFERANS'];
  const rows = d.tasks.filter((t) => !t.deleted_at).sort((a, b) => a.no - b.no).map((t) => {
    const list = (items.get(t.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    const desc = [t.description ?? '', ...list.map((it, i) => `${it.done ? '✓ ' : ''}${i + 1}. ${it.text}${it.note ? ` – ${it.note}` : ''}`)]
      .filter((x, i) => i > 0 || x).join('\n');
    const rd = t.recurrence === 'weekly' ? (L.weekday[t.recurrence_day] ?? '') : (t.recurrence_day ?? '');
    return [t.no, projects.get(t.project_id)?.name ?? '', t.section, t.category ?? '', t.title, desc, (t.tags ?? []).join(', '),
      L.status[t.status], L.priority[t.priority], `${t.progress ?? 0}%`, people.get(t.assignee_id)?.full_name ?? '',
      trDate(t.start_date), t.due_date ? `${trDate(t.due_date)}${t.due_time ? ` ${String(t.due_time).slice(0, 5)}` : ''}` : '',
      t.estimate_minutes ?? '', L.recurrence[t.recurrence], rd, L.reminder[t.reminder], (t.reference_links ?? []).join('\n')];
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), 'Görevler');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['AD SOYAD', 'E-POSTA', 'ROL', 'TELEFON', 'DİL', 'GÜNLÜK ÖZET SAATİ', 'SESSİZ SAATLER', 'SADECE KENDİ GÖREVLERİ'],
    ...d.profiles.map((p) => [p.full_name, p.email ?? '', L.role[p.role], p.phone ?? '', p.language === 'en' ? 'English' : 'Türkçe',
      p.daily_summary_time ? String(p.daily_summary_time).slice(0, 5) : '',
      p.quiet_hours_start && p.quiet_hours_end ? `${String(p.quiet_hours_start).slice(0, 5)}-${String(p.quiet_hours_end).slice(0, 5)}` : '',
      p.only_own_tasks ? 'Evet' : 'Hayır']),
  ]), 'Kişiler');
  const sec = d.lookups.filter((x) => x.kind === 'section').map((x) => x.value);
  const cat = d.lookups.filter((x) => x.kind === 'category').map((x) => x.value);
  const prj = [...d.projects].sort((a, b) => a.sort_order - b.sort_order).map((p) => p.name);
  const n = Math.max(sec.length, cat.length, prj.length);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['PROJE', 'BÖLÜM', 'KATEGORİ'],
    ...Array.from({ length: n }, (_, i) => [prj[i] ?? '', sec[i] ?? '', cat[i] ?? ''])]), 'Listeler');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

// ---------------------------------------------------------------- yedek
async function backup(kind: 'weekly' | 'manual', by: string | null) {
  const tables = ['profiles', 'projects', 'lookups', 'tasks', 'checklist_items', 'task_occurrences', 'attachments', 'task_templates', 'app_settings'];
  // deno-lint-ignore no-explicit-any
  const data: Record<string, any[]> = {};
  for (const t of tables) data[t] = await fetchAll(t, '*', t === 'app_settings' ? 'id' : 'created_at');

  const now = new Date();
  const ist = new Date(now.getTime() + 3 * 3600000).toISOString();   // Türkiye saati
  const stamp = `${ist.slice(0, 10)}_${ist.slice(11, 13)}-${ist.slice(14, 16)}`;
  const base = `${ist.slice(0, 4)}/evodak-yedek-${stamp}${kind === 'manual' ? '-elle' : ''}`;
  const jsonBytes = new TextEncoder().encode(JSON.stringify({ app: 'evodak-gorev-paneli', version: 1, created_at: now.toISOString(), tables: data }));
  const xlsxBytes = buildWorkbook(data);

  const up1 = await db.storage.from('backups').upload(`${base}.json`, jsonBytes, { contentType: 'application/json', upsert: true });
  if (up1.error) throw new Error(`backup json: ${up1.error.message}`);
  const up2 = await db.storage.from('backups').upload(`${base}.xlsx`, xlsxBytes, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true });
  if (up2.error) throw new Error(`backup xlsx: ${up2.error.message}`);

  const { data: row } = await db.from('backups').insert({
    json_path: `${base}.json`, xlsx_path: `${base}.xlsx`, size_bytes: jsonBytes.length + xlsxBytes.length, kind, created_by: by,
  }).select('id,created_at,size_bytes').single();

  // Eski yedekleri sil (en yeni KEEP_BACKUPS kalır)
  const { data: old } = await db.from('backups').select('id,json_path,xlsx_path').order('created_at', { ascending: false }).range(KEEP_BACKUPS, 1000);
  if (old?.length) {
    await db.storage.from('backups').remove(old.flatMap((b) => [b.json_path, b.xlsx_path].filter(Boolean)));
    await db.from('backups').delete().in('id', old.map((b) => b.id));
  }
  return { ...row, tasks: data.tasks.length, removed_old: old?.length ?? 0 };
}

async function daily() {
  const purged = await purgeOld();
  const { data: last } = await db.from('backups').select('created_at').eq('kind', 'weekly').order('created_at', { ascending: false }).limit(1);
  const due = !last?.length || Date.now() - new Date(last[0].created_at).getTime() > WEEK_MS;
  const b = due ? await backup('weekly', null) : null;
  return { purged, backup: b };
}

// ---------------------------------------------------------------- giriş
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.mode === 'daily') {
      const { data: ok } = await db.rpc('check_cron_secret', { s: req.headers.get('x-cron-secret') ?? '' });
      if (!ok) return json({ error: 'unauthorized' }, 401);
      return json({ ok: true, ...(await daily()) });
    }

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u, error } = await db.auth.getUser(jwt);
    if (error || !u?.user) return json({ ok: false, error: 'unauthorized' }, 401);
    const { data: me } = await db.from('profiles').select('id,role,active').eq('user_id', u.user.id).maybeSingle();
    if (!me?.active) return json({ ok: false, error: 'forbidden' }, 403);

    if (body?.mode === 'backup') {
      if (!['owner', 'admin'].includes(me.role)) return json({ ok: false, error: 'forbidden' }, 403);
      return json({ ok: true, backup: await backup('manual', me.id) });
    }
    if (body?.mode === 'purge') {
      if (me.role !== 'owner') return json({ ok: false, error: 'forbidden' }, 403);
      let q = db.from('tasks').select('id').not('deleted_at', 'is', null).limit(5000);
      if (Array.isArray(body.task_ids)) q = q.in('id', body.task_ids.slice(0, 1000).map(String));
      const { data } = await q;
      return json({ ok: true, ...(await deleteTasks((data ?? []).map((x) => x.id))) });
    }
    return json({ ok: false, error: 'bad_mode' }, 400);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
