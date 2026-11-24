// =====================================================================
// Evodak Görev Paneli – Edge Function: maintenance
// Supabase > Edge Functions'a "maintenance" adıyla yüklenir (JWT doğrulama KAPALI).
//   { mode: 'daily' }   pg_cron her gece çağırır (x-cron-secret ile):
//                       30 günü geçen çöpü kalıcı siler, haftada bir yedek alır.
//   { mode: 'backup' }  Ayarlar > Yedekler > "Şimdi yedek al" (owner/admin oturumu)
//   { mode: 'purge', task_ids? }  Çöp kutusu > "Kalıcı sil" / "Çöpü boşalt" (yalnızca owner)
//   { mode: 'restore', backup_id } Ayarlar > Yedekler > "Geri yükle" (yalnızca owner, iki onay)
//                       Önce güncel durumun yedeği alınır, sonra seçilen yedek geri yüklenir.
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
const KEEP_BACKUPS = 8;               // en yeni 8 yedek saklanır (~2 ay)
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
    // İkinci sıra "id": aynı anda eklenen satırların sırası eşit olsa da sayfalar kaymaz (yinelenen/eksik satır olmaz)
    const { data, error } = await db.from(table).select(columns).order(order).order('id').range(from, from + 999);
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

// ---------------------------------------------------------------- Excel (ERA "Görev Takip" biçimi, içe aktarmayla aynı)
const L = {
  status: { todo: 'Başlamadı', in_progress: 'Devam Ediyor', waiting: 'Beklemede', blocked: 'Beklemede', done: 'Tamamlandı', cancelled: 'İptal' },
  priority: { urgent: 'Kritik', high: 'Yüksek', medium: 'Orta', low: 'Düşük' },
  recurrence: { once: 'Tek sefer', daily: 'Günlük', weekdays: 'Hafta içi her gün', weekly: 'Haftalık', monthly: 'Aylık', yearly: 'Yıllık' },
  reminder: { none: 'Yok', at_time: 'Tam zamanında', '15m': '15 dk önce', '1h': '1 saat önce', '1d': '1 gün önce', '1w': '1 hafta önce' },
  weekday: { mon: 'Pazartesi', tue: 'Salı', wed: 'Çarşamba', thu: 'Perşembe', fri: 'Cuma', sat: 'Cumartesi', sun: 'Pazar' },
} as Record<string, Record<string, string>>;
const ERA_HEAD = ['ID', 'Direktörlük / Birim', 'Alt Birim', 'Proje', 'Görev / Fonksiyon', 'Görev Detayı / Açıklama', 'Sorumlu',
  'Öncelik', 'Başlangıç', 'Termin', 'Bitiş (Gerçekleşen)', 'Durum', 'İlerleme %', 'Kalan Gün', 'Termin Durumu',
  'Tekrar Tipi', 'Süre (dk)', 'Adet', 'Günde', 'Haftada', 'Ayda', 'Yılda', 'Yıllık Tekrar', 'Toplam Saat (yıllık)', 'Notlar',
  'Hatırlatma', 'Tekrar Günü', 'Etiketler', 'Referans', 'Kontrol Listesi'];
const BIRIM_PROJECT = 'Evodak Birim İşleri';
const serial = (iso: string | null) => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000 + 25569;
};
// deno-lint-ignore no-explicit-any
function yearlyRepeat(t: any) {
  const f = t.freq_count ?? 1;
  return ({ daily: f * 302.4, weekdays: f * 252, weekly: f * 50.4, monthly: f * 12, yearly: f } as Record<string, number>)[t.recurrence] ?? 1;
}
// deno-lint-ignore no-explicit-any
function recDay(t: any) {
  if (!t.recurrence_day) return '';
  const parts = String(t.recurrence_day).split(',');
  if (t.recurrence === 'weekly') return parts.map((x) => L.weekday[x] ?? x).join(', ');
  if (t.recurrence === 'yearly') return parts.map((x) => { const [m, d] = x.split('-'); return `${d}.${m}`; }).join(', ');
  return parts.join(', ');
}

// deno-lint-ignore no-explicit-any
function buildWorkbook(d: Record<string, any[]>) {
  const projects = new Map(d.projects.map((p) => [p.id, p]));
  const people = new Map(d.profiles.map((p) => [p.id, p]));
  // deno-lint-ignore no-explicit-any
  const items = new Map<string, any[]>();
  for (const it of d.checklist_items) { if (!items.has(it.task_id)) items.set(it.task_id, []); items.get(it.task_id)!.push(it); }
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const coll = new Intl.Collator('tr', { numeric: true });
  const freqIdx: Record<string, number> = { daily: 0, weekdays: 0, weekly: 1, monthly: 2, yearly: 3 };
  const rows = d.tasks.filter((t) => !t.deleted_at).sort((a, b) => coll.compare(a.code ?? `#${a.no}`, b.code ?? `#${b.no}`)).map((t) => {
    const list = (items.get(t.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    const checklist = list.map((it, i) => `${it.done ? '✓ ' : ''}${i + 1}. ${it.text}${it.note ? ` – ${it.note}` : ''}`).join('\n');
    const freq = [null, null, null, null] as (number | null)[];
    if (t.recurrence in freqIdx) freq[freqIdx[t.recurrence]] = t.freq_count ?? 1;
    const left = t.due_date ? Math.round((Date.parse(t.due_date) - Date.parse(today)) / 86400000) : null;
    const open = !['done', 'cancelled'].includes(t.status);
    const state = !t.due_date || !open ? '-' : left! < 0 ? 'Gecikmiş' : left! <= 7 ? 'Yaklaşıyor (≤7 gün)' : 'Takvimde';
    const yr = yearlyRepeat(t);
    const prj = projects.get(t.project_id)?.name ?? '';
    return [t.code ?? `#${t.no}`, t.directorate ?? '', t.section ?? '', prj === BIRIM_PROJECT ? '' : prj, t.category ?? '', t.title,
      people.get(t.assignee_id)?.full_name ?? '', L.priority[t.priority], serial(t.start_date), serial(t.due_date),
      t.status === 'done' && t.completed_at ? serial(new Date(new Date(t.completed_at).getTime() + 3 * 3600000).toISOString()) : null,
      L.status[t.status], (t.progress ?? 0) / 100, left, state, L.recurrence[t.recurrence], t.estimate_minutes ?? null, t.quantity ?? 1,
      ...freq, Math.round(yr * 10) / 10, Math.round(((t.estimate_minutes ?? 0) * (t.quantity ?? 1) * yr) / 60 * 10) / 10,
      t.description ?? '', L.reminder[t.reminder], recDay(t), (t.tags ?? []).join(', '), (t.reference_links ?? []).join('\n'), checklist];
  });
  const head = [
    ['Evodak Gayrimenkul Yönetimi — Görev Takip (haftalık yedek)'],
    [`Yedek tarihi: ${today.slice(8, 10)}.${today.slice(5, 7)}.${today.slice(0, 4)} · ${rows.length} görev. Bu dosya panele geri yüklenebilir (Ayarlar → Veri ve yedek → Excel içe aktar).`],
    [''],
    ERA_HEAD,
  ];
  const ws = XLSX.utils.aoa_to_sheet([...head, ...rows]);
  for (let r = 4; r < rows.length + 4; r++) {
    for (const c of [8, 9, 10]) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell && cell.t === 'n') cell.z = 'dd.mm.yyyy'; }
    const p = ws[XLSX.utils.encode_cell({ r, c: 12 })]; if (p && p.t === 'n') p.z = '0%';
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Görev Takip');
  const pick = (k: string) => d.lookups.filter((x) => x.kind === k).sort((a, b) => a.sort_order - b.sort_order).map((x) => x.value);
  const cols = [pick('directorate'), pick('section'), Object.values(L.status).filter((v, i, a) => a.indexOf(v) === i), Object.values(L.priority),
    d.profiles.filter((p) => p.active !== false).map((p) => p.full_name),
    [...d.projects].sort((a, b) => a.sort_order - b.sort_order).map((p) => p.name), pick('category')];
  const n = Math.max(...cols.map((c) => c.length));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Direktörlük / Birim', 'Alt Birim', 'Durum', 'Öncelik', 'Sorumlu Personel', 'Proje', 'Görev / Fonksiyon'],
    ...Array.from({ length: n }, (_, i) => cols.map((c) => c[i] ?? '')),
  ]), 'Listeler');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }));
}

// ---------------------------------------------------------------- yedek
async function backup(kind: 'weekly' | 'manual', by: string | null) {
  const tables = ['profiles', 'projects', 'lookups', 'tasks', 'checklist_items', 'task_occurrences', 'attachments', 'task_comments', 'task_templates', 'app_settings'];
  // deno-lint-ignore no-explicit-any
  const data: Record<string, any[]> = {};
  for (const t of tables) {
    try { data[t] = await fetchAll(t, '*', t === 'app_settings' ? 'id' : 'created_at'); } catch (e) {
      if (t === 'task_comments') data[t] = []; else throw e;   // eski kurulumda yorum tablosu yoksa
    }
  }

  const now = new Date();
  const ist = new Date(now.getTime() + 3 * 3600000).toISOString();   // Türkiye saati
  const stamp = `${ist.slice(0, 10)}_${ist.slice(11, 13)}-${ist.slice(14, 16)}-${ist.slice(17, 19)}`;
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
    if (body?.mode === 'restore') {
      if (me.role !== 'owner') return json({ ok: false, error: 'forbidden' }, 403);
      const { data: b } = await db.from('backups').select('id,json_path,created_at').eq('id', String(body.backup_id ?? '')).maybeSingle();
      if (!b) return json({ ok: false, error: 'not_found' }, 404);
      const { data: file, error: dlErr } = await db.storage.from('backups').download(b.json_path);
      if (dlErr || !file) return json({ ok: false, error: 'download_failed' }, 500);
      const payload = JSON.parse(await file.text());
      if (payload?.app !== 'evodak-gorev-paneli' || !payload.tables?.tasks) return json({ ok: false, error: 'bad_file' }, 400);
      const safety = await backup('manual', me.id);   // geri dönüş için önce şimdiki hali yedekle
      const { data: res, error: rErr } = await db.rpc('restore_backup', { p: payload, p_by: me.id });
      if (rErr) return json({ ok: false, error: rErr.message, safety_backup: safety?.id }, 500);
      return json({ ok: true, restored: res, from: b.created_at, safety_backup: safety?.id });
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
