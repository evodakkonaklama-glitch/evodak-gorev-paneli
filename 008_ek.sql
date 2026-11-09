-- =====================================================================
-- Evodak Görev Takip Paneli – 008_ek.sql  (Paket 7)
-- 1) Alt görev alanı (parent_task_id) – arayüzü sonraki sürümde
-- 2) Görev yorumları + sorumluya uygulama içi bildirim
-- 3) Listeler: bölüm/kategori yeniden adlandırma (görevlere de yansır)
-- 4) Haftalık özet (pazartesi 09:00) ve kullanılmama uyarısı (bildirim)
-- 5) Yedekten geri yükleme (yalnızca sunucu çağırır, owner iki onayla başlatır)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Alt görev
-- ---------------------------------------------------------------------
alter table public.tasks add column if not exists parent_task_id uuid;
alter table public.tasks drop constraint if exists tasks_parent_fk;
alter table public.tasks add constraint tasks_parent_fk foreign key (parent_task_id)
  references public.tasks(id) on delete set null deferrable initially deferred;
create index if not exists tasks_parent_idx on public.tasks (parent_task_id) where parent_task_id is not null;

-- ---------------------------------------------------------------------
-- 2. Yorumlar
-- ---------------------------------------------------------------------
create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete set null,
  text        text not null check (char_length(btrim(text)) between 1 and 4000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);
alter table public.task_comments enable row level security;
grant select, insert, delete on public.task_comments to authenticated;
grant all on public.task_comments to service_role;

drop policy if exists comments_select on public.task_comments;
drop policy if exists comments_insert on public.task_comments;
drop policy if exists comments_delete on public.task_comments;
create policy comments_select on public.task_comments for select to authenticated
  using (public.can_see_task(task_id));
create policy comments_insert on public.task_comments for insert to authenticated
  with check (public.can_see_task(task_id) and public.my_role() in ('owner','admin','member')
              and profile_id = public.my_profile_id());
create policy comments_delete on public.task_comments for delete to authenticated
  using (profile_id = public.my_profile_id() or public.is_admin());

create or replace function public.tg_comment_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.profile_id := coalesce(new.profile_id, public.my_profile_id());
  new.text := btrim(new.text);
  return new;
end $$;
drop trigger if exists comments_before on public.task_comments;
create trigger comments_before before insert on public.task_comments
  for each row execute function public.tg_comment_before();

-- Yorum eklenince görevin sorumlusuna zil bildirimi (yazan kendisi değilse)
create or replace function public.tg_comment_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare tk public.tasks%rowtype; author text;
begin
  select * into tk from public.tasks where id = new.task_id;
  select full_name into author from public.profiles where id = new.profile_id;
  if tk.assignee_id is not null and tk.assignee_id is distinct from new.profile_id
     and exists (select 1 from public.profiles where id = tk.assignee_id and active) then
    insert into public.inbox (profile_id, task_id, kind, title, body)
    values (tk.assignee_id, tk.id, 'comment', tk.title, coalesce(author, '?') || ': ' || left(new.text, 200));
  end if;
  return null;
end $$;
drop trigger if exists comments_after on public.task_comments;
create trigger comments_after after insert on public.task_comments
  for each row execute function public.tg_comment_after();

do $$ begin
  alter publication supabase_realtime add table public.task_comments;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 3. Listeler: bölüm / kategori adını değiştir (görevler ve şablonlar da güncellenir)
-- ---------------------------------------------------------------------
create or replace function public.rename_lookup(p_kind text, p_old text, p_new text) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; v_new text := btrim(coalesce(p_new, ''));
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok' using errcode = '42501'; end if;
  if p_kind not in ('section','category') or v_new = '' then raise exception 'Geçersiz değer' using errcode = '22023'; end if;
  if lower(v_new) <> lower(p_old) and exists (select 1 from public.lookups where kind = p_kind and lower(value) = lower(v_new)) then
    raise exception 'Bu ad listede zaten var' using errcode = '23505';
  end if;
  update public.lookups set value = v_new where kind = p_kind and value = p_old;
  if p_kind = 'section' then
    update public.tasks set section = v_new where section = p_old;
    get diagnostics n = row_count;
    update public.task_templates set section = v_new where section = p_old;
  else
    update public.tasks set category = v_new where category = p_old;
    get diagnostics n = row_count;
    update public.task_templates set category = v_new where category = p_old;
  end if;
  return n;
end $$;
revoke execute on function public.rename_lookup(text, text, text) from public, anon;
grant  execute on function public.rename_lookup(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Bildirim türleri: haftalık özet, kullanılmama uyarısı
-- ---------------------------------------------------------------------
alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('reminder','daily_summary','weekly_summary','inactivity','overdue','test'));

create or replace function public.plan_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; v_now_ist timestamp := now() at time zone 'Europe/Istanbul';
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

  -- b) Ertelenenler
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

  -- c) Günlük özet (kişinin saatinde)
  with s as (
    select p.id,
           ((v_now_ist::date + p.daily_summary_time) at time zone 'Europe/Istanbul') as fire_at
    from public.profiles p
    where p.active and p.user_id is not null and p.daily_summary_time is not null
  ), ins as (
    insert into public.notification_log (task_id, profile_id, kind, fire_at, channel, send_after)
    select null, s.id, 'daily_summary', s.fire_at, 'push', public.next_allowed_time(s.id, now())
    from s where s.fire_at <= now() and s.fire_at > now() - interval '60 minutes'
    on conflict do nothing
    returning 1
  ) select count(*) into k from ins;
  n := n + k;

  -- d) Haftalık özet: pazartesi 09:00 (Türkiye), herkese
  if extract(isodow from v_now_ist) = 1 then
    with s as (
      select p.id, ((v_now_ist::date + time '09:00') at time zone 'Europe/Istanbul') as fire_at
      from public.profiles p where p.active and p.user_id is not null
    ), ins as (
      insert into public.notification_log (task_id, profile_id, kind, fire_at, channel, send_after)
      select null, s.id, 'weekly_summary', s.fire_at, 'push', public.next_allowed_time(s.id, now())
      from s where s.fire_at <= now() and s.fire_at > now() - interval '60 minutes'
      on conflict do nothing
      returning 1
    ) select count(*) into k from ins;
    n := n + k;
  end if;

  -- e) Kullanılmama uyarısı: panel 5 gündür açılmadıysa her gün 10:00'da owner/admin'e
  if (select last_activity_at from public.app_settings where id = 1) < now() - interval '5 days' then
    with s as (
      select p.id, ((v_now_ist::date + time '10:00') at time zone 'Europe/Istanbul') as fire_at
      from public.profiles p where p.active and p.user_id is not null and p.role in ('owner','admin')
    ), ins as (
      insert into public.notification_log (task_id, profile_id, kind, fire_at, channel, send_after)
      select null, s.id, 'inactivity', s.fire_at, 'push', now()
      from s where s.fire_at <= now() and s.fire_at > now() - interval '60 minutes'
      on conflict do nothing
      returning 1
    ) select count(*) into k from ins;
    n := n + k;
  end if;
  return n;
end $$;
revoke execute on function public.plan_notifications() from public, anon, authenticated;
grant  execute on function public.plan_notifications() to service_role;

-- Panel açılışında son kullanım zamanını ve önceki değeri döndür (uyarı için)
create or replace function public.touch_activity_info() returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev timestamptz;
begin
  if not public.is_team() then return null; end if;
  select last_activity_at into prev from public.app_settings where id = 1;
  update public.profiles set last_seen_at = now() where user_id = auth.uid();
  update public.app_settings set last_activity_at = now() where id = 1;
  return jsonb_build_object('previous', prev, 'daily_work_minutes', (select daily_work_minutes from public.app_settings where id = 1));
end $$;
revoke execute on function public.touch_activity_info() from public, anon;
grant  execute on function public.touch_activity_info() to authenticated;

-- ---------------------------------------------------------------------
-- 5. Yedekten geri yükleme (maintenance fonksiyonu çağırır; önce güncel yedek alınır)
--    Kişiler silinmez: yedekteki kişiler güncellenir/eklenir. Diğer tablolar yedekteki hale döner.
-- ---------------------------------------------------------------------
create or replace function public.restore_backup(p jsonb, p_by uuid) returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare d jsonb := p->'tables'; n_tasks int; n_items int;
begin
  if d is null or jsonb_typeof(d->'tasks') <> 'array' then raise exception 'Yedek dosyası okunamadı' using errcode = '22023'; end if;
  perform set_config('app.importing', 'on', true);
  perform set_config('app.actor', coalesce(p_by::text, ''), true);
  set constraints all deferred;

  -- Kişiler: ekle / güncelle (giriş hesabı bağlantısı korunur)
  insert into public.profiles (id, full_name, email, role, phone, language, theme, daily_summary_time, quiet_hours_start,
                               quiet_hours_end, only_own_tasks, email_notifications, active)
  select x.id, x.full_name, x.email, x.role, x.phone, x.language, coalesce(x.theme, 'system'), x.daily_summary_time,
         x.quiet_hours_start, x.quiet_hours_end, x.only_own_tasks, false, x.active
  from jsonb_populate_recordset(null::public.profiles, d->'profiles') x
  where not exists (select 1 from public.profiles q where q.id <> x.id
                    and (lower(q.full_name) = lower(x.full_name) or lower(q.email) = lower(x.email)))
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, phone = excluded.phone,
    only_own_tasks = excluded.only_own_tasks, active = excluded.active;

  delete from public.task_comments;
  delete from public.checklist_items;
  delete from public.task_occurrences;
  delete from public.attachments;
  delete from public.notification_snoozes;
  delete from public.tasks;
  delete from public.task_templates;
  delete from public.lookups;
  delete from public.projects;

  insert into public.projects select * from jsonb_populate_recordset(null::public.projects, d->'projects');
  insert into public.lookups select * from jsonb_populate_recordset(null::public.lookups, d->'lookups');
  insert into public.task_templates select * from jsonb_populate_recordset(null::public.task_templates, d->'task_templates');
  insert into public.tasks select * from jsonb_populate_recordset(null::public.tasks, d->'tasks');
  get diagnostics n_tasks = row_count;
  insert into public.checklist_items select * from jsonb_populate_recordset(null::public.checklist_items, d->'checklist_items');
  get diagnostics n_items = row_count;
  insert into public.task_occurrences select * from jsonb_populate_recordset(null::public.task_occurrences, coalesce(d->'task_occurrences', '[]'));
  -- Dosya kaydı yalnızca dosya hâlâ depoda duruyorsa geri gelir
  insert into public.attachments
  select a.* from jsonb_populate_recordset(null::public.attachments, coalesce(d->'attachments', '[]')) a
  where exists (select 1 from storage.objects o where o.bucket_id = 'files' and o.name = a.storage_path);
  insert into public.task_comments
  select * from jsonb_populate_recordset(null::public.task_comments, coalesce(d->'task_comments', '[]'));

  update public.tasks set updated_at = now();   -- oran ve hatırlatma yeniden hesaplanır
  perform set_config('app.importing', '', true);

  insert into public.activity_log (entity, entity_id, action, changes, profile_id)
  values ('import', gen_random_uuid(), 'import',
          jsonb_build_object('restore', p->>'created_at', 'tasks', n_tasks, 'items', n_items), p_by);
  return jsonb_build_object('tasks', n_tasks, 'items', n_items);
end $$;
revoke execute on function public.restore_backup(jsonb, uuid) from public, anon, authenticated;
grant  execute on function public.restore_backup(jsonb, uuid) to service_role;

-- Kontrol
select 'paket 7 kuruldu' as durum;
