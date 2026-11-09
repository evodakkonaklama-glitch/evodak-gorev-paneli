// =====================================================================
// Evodak Görev Paneli – Edge Function: manage-users
// Supabase > Edge Functions'a "manage-users" adıyla yüklenir (JWT doğrulama KAPALI).
// Yalnızca owner/admin çağırabilir (kendi oturumuyla). Gizli anahtar sunucuda kalır.
// İşlemler:
//   create       { full_name, email, password, role, only_own_tasks, language }
//   set_password { profile_id, password }
//   set_active   { profile_id, active }
// Kurallar: admin, owner'a dokunamaz ve owner oluşturamaz; kimse kendini pasif yapamaz.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const BAN_FOREVER = '876000h';   // 100 yıl: pasif kişi giriş yapamaz

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
const fail = (code: string, status = 400) => json({ ok: false, error: code }, status);

const ROLES = ['owner', 'admin', 'member', 'viewer'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Profile = { id: string; user_id: string | null; full_name: string; email: string | null; role: string; active: boolean };

async function findAuthUserByEmail(email: string) {
  // Ekip küçük: ilk 1000 hesap içinde ara
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => (u.email ?? '').toLowerCase() === email) ?? null;
}

async function linkProfile(profileId: string, userId: string) {
  await db.from('profiles').update({ user_id: userId }).eq('id', profileId);
}

async function create(me: Profile, b: Record<string, unknown>) {
  const full_name = String(b.full_name ?? '').trim();
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = String(b.password ?? '');
  const role = String(b.role ?? 'member');
  if (!full_name) return fail('name_required');
  if (!EMAIL_RE.test(email)) return fail('email_invalid');
  if (password.length < 8) return fail('password_short');
  if (!ROLES.includes(role)) return fail('role_invalid');
  if (role === 'owner' && me.role !== 'owner') return fail('forbidden', 403);

  // Aynı e-posta ya da aynı adla bir profil varsa (ör. Excel'den gelen) onu kullan
  const { data: all } = await db.from('profiles').select('id,user_id,full_name,email,role,active');
  const byEmail = (all ?? []).find((p) => (p.email ?? '').toLowerCase() === email) as Profile | undefined;
  const byName = (all ?? []).find((p) => p.full_name.toLocaleLowerCase('tr') === full_name.toLocaleLowerCase('tr')) as Profile | undefined;
  if (byName && byEmail && byName.id !== byEmail.id) return fail('name_taken');
  let profile = byEmail ?? byName;
  if (profile?.user_id) return fail('already_has_account');
  if (profile && profile.role === 'owner' && me.role !== 'owner') return fail('forbidden', 403);

  const fields = {
    full_name, email, role,
    only_own_tasks: Boolean(b.only_own_tasks),
    language: b.language === 'en' ? 'en' : 'tr',
    active: true,
  };
  if (profile) {
    const { error } = await db.from('profiles').update(fields).eq('id', profile.id);
    if (error) return fail(error.code === '23505' ? 'name_taken' : 'db_error');
  } else {
    const { data, error } = await db.from('profiles').insert(fields).select('id,user_id,full_name,email,role,active').single();
    if (error) return fail(error.code === '23505' ? 'name_taken' : 'db_error');
    profile = data as Profile;
  }

  // Hesap aç (e-posta onayı gerekmez, geçici şifreyle hemen girer)
  const { data: created, error: authErr } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  let userId = created?.user?.id;
  if (authErr) {
    // Hesap zaten varsa (ör. önceden silinmiş profil) şifresini güncelleyip bağla
    const u = await findAuthUserByEmail(email);
    if (!u) return fail('auth_error');
    const { error: upErr } = await db.auth.admin.updateUserById(u.id, { password, ban_duration: 'none' });
    if (upErr) return fail('auth_error');
    userId = u.id;
  }
  await linkProfile(profile.id, userId!);
  return json({ ok: true, profile_id: profile.id });
}

async function target(me: Profile, id: unknown) {
  const { data } = await db.from('profiles').select('id,user_id,full_name,email,role,active').eq('id', String(id ?? '')).maybeSingle();
  const p = data as Profile | null;
  if (!p) return { err: fail('not_found', 404) };
  if (p.role === 'owner' && me.role !== 'owner' && p.id !== me.id) return { err: fail('forbidden', 403) };
  return { p };
}

async function setPassword(me: Profile, b: Record<string, unknown>) {
  const { p, err } = await target(me, b.profile_id);
  if (err) return err;
  const password = String(b.password ?? '');
  if (password.length < 8) return fail('password_short');
  if (!p!.user_id) {
    // Hesabı yoksa (Excel'den gelen kişi): bu şifreyle hesap aç
    if (!p!.email) return fail('email_required');
    return create(me, { full_name: p!.full_name, email: p!.email, password, role: p!.role, only_own_tasks: false });
  }
  const { error } = await db.auth.admin.updateUserById(p!.user_id, { password });
  if (error) return fail('auth_error');
  return json({ ok: true });
}

async function setActive(me: Profile, b: Record<string, unknown>) {
  const { p, err } = await target(me, b.profile_id);
  if (err) return err;
  const active = Boolean(b.active);
  if (p!.id === me.id && !active) return fail('self');
  const { error } = await db.from('profiles').update({ active }).eq('id', p!.id);
  if (error) return fail(error.message.includes('owner') ? 'last_owner' : 'db_error');
  if (p!.user_id) {
    await db.auth.admin.updateUserById(p!.user_id, { ban_duration: active ? 'none' : BAN_FOREVER });
    // Pasif kişinin cihaz kayıtları silinir: bildirim almaz
    if (!active) await db.from('push_subscriptions').delete().eq('profile_id', p!.id);
  }
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u, error } = await db.auth.getUser(jwt);
    if (error || !u?.user) return fail('unauthorized', 401);
    const { data: me } = await db.from('profiles').select('id,user_id,full_name,email,role,active')
      .eq('user_id', u.user.id).maybeSingle();
    if (!me || !me.active || !['owner', 'admin'].includes(me.role)) return fail('forbidden', 403);

    const b = await req.json().catch(() => ({}));
    if (b.action === 'create') return await create(me as Profile, b);
    if (b.action === 'set_password') return await setPassword(me as Profile, b);
    if (b.action === 'set_active') return await setActive(me as Profile, b);
    return fail('bad_action');
  } catch (e) {
    console.error(e);
    return fail('server_error', 500);
  }
});
