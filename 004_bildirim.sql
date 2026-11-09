-- =====================================================================
-- Evodak Görev Takip Paneli – 004_bildirim.sql  (2. aşama)
-- Sunucuda her dakika çalışan hatırlatma sistemi.
-- 003_seed.sql'den SONRA, Edge Function'lar yüklendikten SONRA çalıştırın.
-- Bu dosyada gizli bilgi yoktur; zamanlayıcı şifresi veritabanının içinde
-- rastgele üretilir ve Vault'ta saklanır. 'apikey' herkese açık panel
-- anahtarıdır (config.js ile aynı); Supabase işlev kapısı bunu ister.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- 1. Gönderim kuyruğu alanları
-- ---------------------------------------------------------------------
alter table public.notification_log
  add column if not exists send_after timestamptz not null default now();
alter table public.notification_log drop constraint if exists notification_log_status_check;
alter table public.notification_log add constraint notification_log_status_check
  check (status in ('pending','sending','sent','failed','skipped'));
create index if not exists notification_log_queue_idx on public.notification_log (send_after) where status in ('pending','failed','sending');

-- ---------------------------------------------------------------------
-- 2. İşlemi yapan kişi: sunucu işlemlerinde (bildirim düğmeleri) kaydı
--    "kim yaptı" bilgisiyle tutmak için. Giriş yapmış kullanıcıyı etkilemez.
-- ---------------------------------------------------------------------
create or replace function public.my_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.profiles where user_id = auth.uid() and active),
    case when auth.uid() is null then nullif(current_setting('app.actor', true), '')::uuid end)
$$;

-- ---------------------------------------------------------------------
-- 3. Sessiz saat: bildirim sessiz saate düşerse sessiz saat bitimine ertelenir
-- ---------------------------------------------------------------------
create or replace function public.next_allowed_time(p_profile uuid, p_at timestamptz)
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare
  qs time; qe time;
  loc timestamp := p_at at time zone 'Europe/Istanbul';
  t time := loc::time;
  d date := loc::date;
begin
  select quiet_hours_start, quiet_hours_end into qs, qe from public.profiles where id = p_profile;
  if qs is null or qe is null or qs = qe then return p_at; end if;
  if qs < qe then                                   -- ör. 13:00-14:00
    if t >= qs and t < qe then return (d + qe) at time zone 'Europe/Istanbul'; end if;
  else                                              -- ör. 22:00-08:00 (gece yarısını aşar)
    if t >= qs then return ((d + 1) + qe) at time zone 'Europe/Istanbul'; end if;
    if t < qe then return (d + qe) at time zone 'Europe/Istanbul'; end if;
  end if;
  return p_at;
end $$;

-- ---------------------------------------------------------------------
-- 4. Planlama: zamanı gelen hatırlatmaları ve ertelemeleri kuyruğa yazar.
--    Benzersiz anahtar sayesinde aynı bildirim ikinci kez kuyruğa giremez.
-- ---------------------------------------------------------------------
create or replace function public.plan_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  -- a) Görev hatırlatmaları (son 60 dakikada zamanı gelenler)
  with due as (
    select t.id, t.assignee_id, t.next_reminder_at
    from public.tasks t
    where t.next_reminder_at <= now()
      and t.next_reminder_at > now() - interval '60 minutes'
      and t.deleted_at is null
      and t.status not in ('done','cancelled')
  ), rcpt as (
    select d.id as task_id, d.next_reminder_at as fire_at, p.id as profile_id, p.email_notifications, p.email
    from due d
    join public.profiles p on p.active and (
      p.id = d.assignee_id
      or (d.assignee_id is null and p.role in ('owner','admin') and not p.only_own_tasks))
  ), ins as (
    insert into public.notification_log (task_id, profile_id, kind, fire_at, channel, send_after)
    select task_id, profile_id, 'reminder', fire_at, 'push', public.next_allowed_time(profile_id, now()) from rcpt
    union all
    select task_id, profile_id, 'reminder', fire_at, 'email', public.next_allowed_time(profile_id, now())
    from rcpt where email_notifications and email is not null
    on conflict do nothing
    returning 1
  ) select count(*) into k from ins;
  n := n + k;

  -- b) "10 dk ertele" ile ertelenenler
  with s as (
    update public.notification_snoozes z set sent_at = now()
    from public.tasks t
    where z.task_id = t.id and z.sent_at is null and z.until <= now()
    returning z.task_id, z.profile_id, z.until, t.status, t.deleted_at
  ), ins as (
    insert into public.notification_log (task_id, profile_id, kind, fire_at, channel, send_after)
    select s.task_id, s.profile_id, 'reminder', s.until, 'push', public.next_allowed_time(s.profile_id, now())
    from s where s.deleted_at is null and s.status not in ('done','cancelled')
    on conflict do nothing
    returning 1
  ) select count(*) into k from ins;
  n := n + k;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 5. Kuyruktan iş alma: aynı satırı iki çalışma aynı anda alamaz.
--    Başarısız gönderim en fazla 3 kez denenir.
-- ---------------------------------------------------------------------
create or replace function public.claim_notifications(p_limit int default 200)
returns table (id uuid, task_id uuid, profile_id uuid, kind text, channel text, fire_at timestamptz, attempts int)
language sql security definer set search_path = public as $$
  update public.notification_log l
     set status = 'sending', attempts = l.attempts + 1, updated_at = now()
   where l.id in (
     select q.id from public.notification_log q
      where q.send_after <= now()
        and q.attempts < 3
        and (q.status = 'pending'
             or q.status = 'failed'
             or (q.status = 'sending' and q.updated_at < now() - interval '5 minutes'))
      order by q.send_after
      limit p_limit
      for update skip locked)
  returning l.id, l.task_id, l.profile_id, l.kind, l.channel, l.fire_at, l.attempts
$$;

-- ---------------------------------------------------------------------
-- 6. Bildirimdeki "Tamamlandı" / "10 dk ertele" düğmeleri (tek kullanımlık token)
-- ---------------------------------------------------------------------
create or replace function public.use_action_token(p_hash text, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tk public.notification_action_tokens%rowtype; tsk public.tasks%rowtype;
begin
  if p_action not in ('done','snooze') then return jsonb_build_object('ok', false, 'error', 'bad_action'); end if;
  select * into tk from public.notification_action_tokens where token_hash = p_hash for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if tk.used_at is not null then return jsonb_build_object('ok', false, 'error', 'used'); end if;
  if tk.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  update public.notification_action_tokens set used_at = now() where token_hash = p_hash;

  select * into tsk from public.tasks where id = tk.task_id;
  if not found or tsk.deleted_at is not null then return jsonb_build_object('ok', false, 'error', 'deleted'); end if;

  perform set_config('app.actor', tk.profile_id::text, true);
  if p_action = 'done' then
    update public.checklist_items set done = true where task_id = tsk.id and not done;
    update public.tasks set status = 'done' where id = tsk.id and status <> 'done';
  else
    insert into public.notification_snoozes (task_id, profile_id, until)
    values (tsk.id, tk.profile_id, now() + interval '10 minutes');
  end if;
  return jsonb_build_object('ok', true, 'action', p_action, 'title', tsk.title);
end $$;

-- ---------------------------------------------------------------------
-- 7. Cihaz kaydı: aynı telefon/bilgisayar başka kişiyle girilmişse kayıt yeni kişiye geçer
-- ---------------------------------------------------------------------
create or replace function public.register_push(p_endpoint text, p_p256dh text, p_auth text,
                                                p_device text, p_ua text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_profile_id(); rid uuid;
begin
  if me is null or auth.uid() is null then raise exception 'Giriş gerekli' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and profile_id <> me;
  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, device_name, user_agent)
  values (me, p_endpoint, p_p256dh, p_auth, p_device, p_ua)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth,
    device_name = excluded.device_name, user_agent = excluded.user_agent, failure_count = 0
  returning id into rid;
  return rid;
end $$;

-- ---------------------------------------------------------------------
-- 8. Zamanlayıcı şifresi (Vault'ta, rastgele) ve kontrolü
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'cron_secret',
                                'send-reminders Edge Function çağrı şifresi');
  end if;
end $$;

create or replace function public.check_cron_secret(s text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and decrypted_secret = s)
$$;

-- Yetkiler: bu fonksiyonları yalnızca sunucu (service_role) çağırabilir
revoke execute on function public.plan_notifications()                  from public, anon, authenticated;
revoke execute on function public.claim_notifications(int)              from public, anon, authenticated;
revoke execute on function public.use_action_token(text, text)          from public, anon, authenticated;
revoke execute on function public.check_cron_secret(text)               from public, anon, authenticated;
revoke execute on function public.next_allowed_time(uuid, timestamptz)  from public, anon, authenticated;
grant  execute on function public.plan_notifications()                  to service_role;
grant  execute on function public.claim_notifications(int)              to service_role;
grant  execute on function public.use_action_token(text, text)          to service_role;
grant  execute on function public.check_cron_secret(text)               to service_role;
grant  execute on function public.next_allowed_time(uuid, timestamptz)  to service_role;
revoke execute on function public.register_push(text, text, text, text, text) from public, anon;
grant  execute on function public.register_push(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Her dakika send-reminders'ı çağır
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-reminders') then
    perform cron.unschedule('send-reminders');
  end if;
end $$;

select cron.schedule('send-reminders', '* * * * *', $job$
  select net.http_post(
    url := 'https://znmeghdcyrarfpkuxtvp.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_eRXjy8MMFBk_k_AL1H4koQ_jHdJX9NU',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"mode":"cron"}'::jsonb,
    timeout_milliseconds := 55000)
$job$);

-- Eski kayıtları temizle (her gece 03:15): 30 günden eski bildirim kaydı ve token
select cron.schedule('cleanup-notifications', '15 0 * * *', $job$
  delete from public.notification_log where created_at < now() - interval '30 days';
  delete from public.notification_action_tokens where expires_at < now() - interval '1 day';
$job$);

-- Kontrol: iki zamanlanmış iş görmelisiniz
select jobname, schedule, active from cron.job order by jobname;
