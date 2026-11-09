// =====================================================================
// Evodak Görev Paneli – Edge Function: send-reminders
// Supabase > Edge Functions'a "send-reminders" adıyla yüklenir.
// pg_cron her dakika çağırır (x-cron-secret ile). Panel "Test bildirimi"
// için kullanıcının oturumuyla çağırır ({ mode: 'test' }).
// Gizli değerler Edge Function Secrets'tan okunur:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, RESEND_API_KEY, MAIL_FROM, APP_URL
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://evodakkonaklama-glitch.github.io/evodak-gorev-paneli/').replace(/\/?$/, '/');
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? 'Evodak Panel <onboarding@resend.dev>';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const VAPID = {
  subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:evodak.konaklama@gmail.com',
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
};
const GROUP_THRESHOLD = 3;   // aynı anda 3'ten fazla hatırlatma tek bildirimde toplanır
const MAX_ATTEMPTS = 3;

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

// ---------------------------------------------------------------- metinler
const TEXT = {
  tr: {
    done: 'Tamamlandı', snooze: '10 dk ertele',
    groupTitle: (n: number) => `${n} görev için hatırlatma`,
    more: (n: number) => `+${n} görev daha`,
    testTitle: 'Test bildirimi', testBody: 'Bildirimler bu cihazda çalışıyor ✓',
    due: 'Bitiş', noDue: 'Bitiş tarihi yok',
    overdueDays: (n: number) => `${n} gün gecikti`, overdueHours: (n: number) => `${n} sa gecikti`, overdueMin: (n: number) => `${n} dk gecikti`, now: 'Şimdi',
    leftMin: (n: number) => `${n} dk kaldı`, leftHours: (n: number) => `${n} sa kaldı`, leftDays: (n: number) => `${n} gün kaldı`,
    mailSubject: (t: string) => `Hatırlatma: ${t}`, mailGroupSubject: (n: number) => `${n} görev için hatırlatma`,
    open: 'Panelde aç', footer: 'Bu e-posta Evodak Görev Paneli tarafından gönderildi.',
  },
  en: {
    done: 'Done', snooze: 'Snooze 10 min',
    groupTitle: (n: number) => `Reminder for ${n} tasks`,
    more: (n: number) => `+${n} more tasks`,
    testTitle: 'Test notification', testBody: 'Notifications work on this device ✓',
    due: 'Due', noDue: 'No due date',
    overdueDays: (n: number) => `${n} days overdue`, overdueHours: (n: number) => `${n} h overdue`, overdueMin: (n: number) => `${n} min overdue`, now: 'Now',
    leftMin: (n: number) => `${n} min left`, leftHours: (n: number) => `${n} h left`, leftDays: (n: number) => `${n} days left`,
    mailSubject: (t: string) => `Reminder: ${t}`, mailGroupSubject: (n: number) => `Reminder for ${n} tasks`,
    open: 'Open in panel', footer: 'This email was sent by the Evodak Task Panel.',
  },
};
type Lang = keyof typeof TEXT;
const L = (lang?: string) => TEXT[(lang === 'en' ? 'en' : 'tr') as Lang];

// ---------------------------------------------------------------- tarih
const pad = (n: number) => String(n).padStart(2, '0');

// İstanbul yerel tarih+saat -> gerçek zaman (Türkiye: sabit UTC+3)
export function istanbulToDate(date: string, time = '09:00'): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 3, mm));
}

export function dueLine(task: { due_date: string | null; due_time: string | null }, lang: string, now = new Date()): string {
  const t = L(lang);
  if (!task.due_date) return t.noDue;
  const time = (task.due_time ?? '09:00').slice(0, 5);
  const [y, m, d] = task.due_date.split('-');
  const at = istanbulToDate(task.due_date, time);
  const diff = at.getTime() - now.getTime();
  let rel: string;
  if (Math.abs(diff) < 120000) rel = t.now;
  else if (diff < 0) {
    const days = Math.floor(-diff / 86400000);
    rel = days >= 1 ? t.overdueDays(days)
      : -diff < 3600000 ? t.overdueMin(Math.round(-diff / 60000)) : t.overdueHours(Math.round(-diff / 3600000));
  } else if (diff < 3600000) rel = t.leftMin(Math.max(1, Math.round(diff / 60000)));
  else if (diff < 86400000) rel = t.leftHours(Math.round(diff / 3600000));
  else rel = t.leftDays(Math.round(diff / 86400000));
  return `${d}.${m}.${y} ${time} · ${rel}`;
}

// ---------------------------------------------------------------- yardımcılar
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; device_name: string | null; profile_id: string; failure_count?: number };
type SendResult = { ok: boolean; status: number; error?: string; device?: string | null };

// Tek bir cihaza Web Push gönderir. 404/410 gelirse cihaz kaydı silinir.
export async function sendPush(sub: Sub, payload: unknown): Promise<SendResult> {
  try {
    const req = webpush.generateRequestDetails(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { vapidDetails: VAPID, TTL: 86400, urgency: 'high', contentEncoding: 'aes128gcm' },
    );
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (k.toLowerCase() !== 'content-length') headers[k] = String(v);
    const res = await fetch(req.endpoint, { method: 'POST', headers, body: new Uint8Array(req.body as Uint8Array) });
    const text = res.ok ? '' : (await res.text()).slice(0, 300);
    if (res.ok) {
      await db.from('push_subscriptions').update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq('id', sub.id);
    } else if (res.status === 404 || res.status === 410) {
      await db.from('push_subscriptions').delete().eq('id', sub.id);
    } else {
      await db.from('push_subscriptions').update({ failure_count: (sub.failure_count ?? 0) + 1 }).eq('id', sub.id);
    }
    return { ok: res.ok, status: res.status, error: text || undefined, device: sub.device_name };
  } catch (e) {
    return { ok: false, status: 0, error: String((e as Error)?.message ?? e), device: sub.device_name };
  }
}

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<SendResult> {
  if (!RESEND_API_KEY) return { ok: false, status: 0, error: 'RESEND_API_KEY tanımlı değil' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html, text }),
  });
  return { ok: res.ok, status: res.status, error: res.ok ? undefined : (await res.text()).slice(0, 300) };
}

function mailHtml(lines: { title: string; sub: string; url: string }[], lang: string) {
  const t = L(lang);
  const items = lines.map((l) => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #e5e9ef">
      <div style="font-weight:700;color:#14304D;font-size:15px">${escapeHtml(l.title)}</div>
      <div style="color:#5d6b7c;font-size:13px;margin:4px 0 8px">${escapeHtml(l.sub)}</div>
      <a href="${l.url}" style="display:inline-block;background:#14304D;color:#fff;text-decoration:none;padding:7px 14px;border-radius:7px;font-size:13px;font-weight:700">${t.open}</a>
    </td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;background:#EEF1F5;padding:24px">
    <div style="max-width:520px;margin:auto;background:#fff;border-radius:12px;padding:20px 24px">
      <div style="font-weight:800;color:#14304D;font-size:16px;margin-bottom:8px">Evodak</div>
      <table style="width:100%;border-collapse:collapse">${items}</table>
      <p style="color:#8a96a5;font-size:12px;margin-top:18px">${t.footer}</p>
    </div></div>`;
}

// ---------------------------------------------------------------- kuyruk işleme
type Row = { id: string; task_id: string | null; profile_id: string; kind: string; channel: string; fire_at: string; attempts: number };
type Task = { id: string; title: string; due_date: string | null; due_time: string | null; status: string; deleted_at: string | null; projects: { name: string } | null };
type Profile = { id: string; full_name: string; email: string | null; language: string };

async function finish(ids: string[], status: 'sent' | 'failed' | 'skipped', error?: string) {
  if (!ids.length) return;
  await db.from('notification_log').update({
    status, last_error: error ?? null, sent_at: status === 'sent' ? new Date().toISOString() : null,
  }).in('id', ids);
}

async function queueEmailFallback(rows: Row[]) {
  if (!rows.length) return;
  await db.from('notification_log').upsert(rows.map((r) => ({
    task_id: r.task_id, profile_id: r.profile_id, kind: r.kind, fire_at: r.fire_at, channel: 'email',
    status: 'pending', send_after: new Date().toISOString(),
  })), { onConflict: 'task_id,profile_id,kind,fire_at,channel', ignoreDuplicates: true });
}

function taskPayload(task: Task, lang: string, token: string) {
  const t = L(lang);
  return {
    title: task.title,
    body: `${task.projects?.name ?? ''}\n${dueLine(task, lang)}`.trim(),
    url: `${APP_URL}#/gorev/${task.id}`,
    tag: `task-${task.id}`,
    token,
    actionUrl: `${SUPABASE_URL}/functions/v1/notification-action`,
    lang,
    actions: [{ action: 'done', title: t.done }, { action: 'snooze', title: t.snooze }],
  };
}

async function processPush(profile: Profile, rows: Row[], tasks: Map<string, Task>, subs: Sub[]) {
  const lang = profile.language;
  // İlk denemede uygulama içi bildirim merkezine de yaz
  const firstTry = rows.filter((r) => r.attempts === 1 && r.task_id);
  if (firstTry.length) {
    await db.from('inbox').insert(firstTry.map((r) => {
      const task = tasks.get(r.task_id!)!;
      return { profile_id: profile.id, task_id: task.id, kind: r.kind, title: task.title, body: dueLine(task, lang) };
    }));
  }

  if (!subs.length) {
    await finish(rows.map((r) => r.id), 'skipped', 'no_subscription');
    await queueEmailFallback(rows);
    return;
  }

  const groups: { rows: Row[]; payload: unknown }[] = [];
  if (rows.length > GROUP_THRESHOLD) {
    const t = L(lang);
    const titles = rows.map((r) => tasks.get(r.task_id!)!.title);
    groups.push({
      rows,
      payload: {
        title: t.groupTitle(rows.length),
        body: titles.slice(0, GROUP_THRESHOLD).map((x) => `• ${x}`).join('\n') +
          (titles.length > GROUP_THRESHOLD ? `\n${t.more(titles.length - GROUP_THRESHOLD)}` : ''),
        url: `${APP_URL}#/gorevler`, tag: `group-${Date.now()}`, lang, actions: [],
      },
    });
  } else {
    for (const r of rows) {
      const task = tasks.get(r.task_id!)!;
      const token = randomToken();
      await db.from('notification_action_tokens').insert({
        token_hash: await sha256Hex(token), task_id: task.id, profile_id: profile.id,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      groups.push({ rows: [r], payload: taskPayload(task, lang, token) });
    }
  }

  for (const g of groups) {
    const results = await Promise.all(subs.map((s) => sendPush(s, g.payload)));
    if (results.some((x) => x.ok)) {
      await finish(g.rows.map((r) => r.id), 'sent');
    } else {
      const err = results.map((x) => `${x.device ?? '?'}: ${x.status} ${x.error ?? ''}`).join(' | ');
      await finish(g.rows.map((r) => r.id), 'failed', err);
      const exhausted = g.rows.filter((r) => r.attempts >= MAX_ATTEMPTS);
      await queueEmailFallback(exhausted);
    }
  }
}

async function processEmail(profile: Profile, rows: Row[], tasks: Map<string, Task>) {
  if (!profile.email) { await finish(rows.map((r) => r.id), 'skipped', 'no_email'); return; }
  const t = L(profile.language);
  const lines = rows.map((r) => {
    const task = tasks.get(r.task_id!)!;
    return { title: task.title, sub: `${task.projects?.name ?? ''} · ${dueLine(task, profile.language)}`, url: `${APP_URL}#/gorev/${task.id}` };
  });
  const subject = lines.length === 1 ? t.mailSubject(lines[0].title) : t.mailGroupSubject(lines.length);
  const text = lines.map((l) => `${l.title}\n${l.sub}\n${l.url}`).join('\n\n');
  const res = await sendEmail(profile.email, subject, mailHtml(lines, profile.language), text);
  await finish(rows.map((r) => r.id), res.ok ? 'sent' : 'failed', res.ok ? undefined : `${res.status} ${res.error ?? ''}`);
}

async function runCron() {
  const { data: planned, error: planErr } = await db.rpc('plan_notifications');
  if (planErr) throw planErr;
  const { data: claimed, error: claimErr } = await db.rpc('claim_notifications', { p_limit: 200 });
  if (claimErr) throw claimErr;
  const rows = (claimed ?? []) as Row[];
  if (!rows.length) return { planned, processed: 0 };

  const taskIds = [...new Set(rows.map((r) => r.task_id).filter(Boolean))] as string[];
  const profileIds = [...new Set(rows.map((r) => r.profile_id))];
  const [{ data: taskData }, { data: profData }, { data: subData }] = await Promise.all([
    db.from('tasks').select('id,title,due_date,due_time,status,deleted_at,projects(name)').in('id', taskIds.length ? taskIds : ['00000000-0000-0000-0000-000000000000']),
    db.from('profiles').select('id,full_name,email,language').in('id', profileIds),
    db.from('push_subscriptions').select('id,endpoint,p256dh,auth,device_name,profile_id,failure_count').in('profile_id', profileIds),
  ]);
  const tasks = new Map((taskData ?? []).map((t) => [t.id, t as unknown as Task]));
  const profiles = new Map((profData ?? []).map((p) => [p.id, p as Profile]));

  // Görev silinmiş/tamamlanmışsa gönderme
  const valid: Row[] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    const task = r.task_id ? tasks.get(r.task_id) : null;
    if (!task || task.deleted_at || ['done', 'cancelled'].includes(task.status) || !profiles.has(r.profile_id)) skipped.push(r.id);
    else valid.push(r);
  }
  await finish(skipped, 'skipped', 'task_closed');

  for (const profile of profiles.values()) {
    const mine = valid.filter((r) => r.profile_id === profile.id);
    const subs = (subData ?? []).filter((s) => s.profile_id === profile.id) as Sub[];
    const push = mine.filter((r) => r.channel === 'push');
    const mail = mine.filter((r) => r.channel === 'email');
    if (push.length) await processPush(profile, push, tasks, subs);
    if (mail.length) await processEmail(profile, mail, tasks);
  }
  return { planned, processed: rows.length, skipped: skipped.length };
}

// Paneldeki "Test bildirimi gönder" düğmesi
async function runTest(req: Request) {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error } = await db.auth.getUser(jwt);
  if (error || !userData?.user) return json({ error: 'unauthorized' }, 401);
  const { data: profile } = await db.from('profiles').select('id,full_name,email,language,active')
    .eq('user_id', userData.user.id).maybeSingle();
  if (!profile || !profile.active) return json({ error: 'no_profile' }, 403);

  const t = L(profile.language);
  const { data: subs } = await db.from('push_subscriptions').select('id,endpoint,p256dh,auth,device_name,profile_id,failure_count').eq('profile_id', profile.id);
  const payload = { title: t.testTitle, body: t.testBody, url: `${APP_URL}#/ayarlar`, tag: `test-${Date.now()}`, lang: profile.language, actions: [] };
  const devices = await Promise.all((subs ?? []).map((s) => sendPush(s as Sub, payload)));
  const now = new Date().toISOString();

  let email: SendResult | null = null;
  if (!devices.some((d) => d.ok) && profile.email) {
    email = await sendEmail(profile.email, t.testTitle, mailHtml([{ title: t.testTitle, sub: t.testBody, url: `${APP_URL}#/ayarlar` }], profile.language), t.testBody);
  }
  await db.from('notification_log').insert({
    task_id: null, profile_id: profile.id, kind: 'test', fire_at: now, channel: devices.some((d) => d.ok) ? 'push' : 'email',
    status: devices.some((d) => d.ok) || email?.ok ? 'sent' : 'failed', attempts: 1, sent_at: now,
    last_error: devices.filter((d) => !d.ok).map((d) => `${d.device}: ${d.status} ${d.error ?? ''}`).join(' | ') || null,
  });
  await db.from('inbox').insert({ profile_id: profile.id, kind: 'test', title: t.testTitle, body: t.testBody });
  return json({ devices, email });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.mode === 'test') return await runTest(req);
    const secret = req.headers.get('x-cron-secret') ?? '';
    const { data: ok } = await db.rpc('check_cron_secret', { s: secret });
    if (!ok) return json({ error: 'unauthorized' }, 401);
    return json(await runCron());
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
