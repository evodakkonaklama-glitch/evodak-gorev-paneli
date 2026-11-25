-- =====================================================================
-- Evodak Görev Takip Paneli – 011_coklu_sorumlu.sql  (Paket 10)
-- 010_era.sql'den SONRA, Supabase → SQL Editor'de bir kez çalıştırın. Tekrar çalıştırılırsa zarar vermez.
--
-- 1) Bir görevde birden çok sorumlu: ana sorumlu (assignee_id) + ek sorumlular (co_assignee_ids)
-- 2) "Sınıf" alanı (task_class)
-- 3) Yetki, bildirim ve yorum bildirimi ek sorumluları da kapsar
-- 4) Excel içe aktarma: ek sorumlular, Sınıf, proje yeniden adlandırma (aynı kod öneki), boşalan projeyi arşivleme
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ALANLAR
-- ---------------------------------------------------------------------
alter table public.tasks add column if not exists co_assignee_ids uuid[] not null default '{}';
alter table public.tasks add column if not exists task_class text;
alter table public.task_templates add column if not exists task_class text;
create index if not exists tasks_co_assignee_idx on public.tasks using gin (co_assignee_ids);

-- Bu görev bana mı ait? (ana veya ek sorumlu)
create or replace function public.is_my_task(p_assignee uuid, p_co uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_profile_id() is not null
     and (p_assignee = public.my_profile_id() or public.my_profile_id() = any(coalesce(p_co, '{}')))
$$;
revoke execute on function public.is_my_task(uuid, uuid[]) from public, anon;
grant  execute on function public.is_my_task(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 2. YETKİ: görmek ve düzenlemek ek sorumluları da kapsar
-- ---------------------------------------------------------------------
create or replace function public.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and public.is_team()
      and (public.is_admin() or not public.my_only_own() or public.is_my_task(t.assignee_id, t.co_assignee_ids))
      and (t.deleted_at is null or public.is_admin())
  )
$$;

create or replace function public.can_edit_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (public.is_admin()
           or (public.my_role() = 'member' and public.is_my_task(t.assignee_id, t.co_assignee_ids)))
  )
$$;

drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_update on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (public.is_team()
         and (public.is_admin() or not public.my_only_own() or public.is_my_task(assignee_id, co_assignee_ids))
         and (deleted_at is null or public.is_admin()));
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_admin() or (public.my_role() = 'member' and public.is_my_task(assignee_id, co_assignee_ids)))
  with check (public.is_admin() or (public.my_role() = 'member' and public.is_my_task(assignee_id, co_assignee_ids)));

-- Ek sorumlular: tekrarsız, boşsuz, ana sorumlu hariç; üye bu listeyi değiştiremez
create or replace function public.tg_tasks_co() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.co_assignee_ids := coalesce(array(
    select distinct x from unnest(coalesce(new.co_assignee_ids, '{}')) x
    where x is not null and x is distinct from new.assignee_id
    order by x), '{}');
  new.task_class := nullif(btrim(coalesce(new.task_class, '')), '');
  if tg_op = 'UPDATE' and public.my_role() = 'member' and new.co_assignee_ids is distinct from old.co_assignee_ids then
    raise exception 'Bu alanı değiştirme yetkiniz yok' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists tasks_before_co on public.tasks;
create trigger tasks_before_co before insert or update on public.tasks
  for each row execute function public.tg_tasks_co();

-- ---------------------------------------------------------------------
-- 3. YORUM BİLDİRİMİ: tüm sorumlulara (yazan hariç)
-- ---------------------------------------------------------------------
create or replace function public.tg_comment_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare tk public.tasks%rowtype; author text;
begin
  select * into tk from public.tasks where id = new.task_id;
  select full_name into author from public.profiles where id = new.profile_id;
  insert into public.inbox (profile_id, task_id, kind, title, body)
  select p.id, tk.id, 'comment', tk.title, coalesce(author, '?') || ': ' || left(new.text, 200)
  from public.profiles p
  where p.active and p.id is distinct from new.profile_id
    and (p.id = tk.assignee_id or p.id = any(tk.co_assignee_ids));
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 4. BİLDİRİM PLANLAMA: hatırlatma tüm sorumlulara (008'deki sürümün yerine geçer)
-- ---------------------------------------------------------------------
create or replace function public.plan_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; v_now_ist timestamp := now() at time zone 'Europe/Istanbul';
begin
  -- a) Görev hatırlatmaları (son 60 dakikada zamanı gelenler)
  with due as (
    select t.id, t.assignee_id, t.co_assignee_ids, t.next_reminder_at
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
      or p.id = any(d.co_assignee_ids)
      or (d.assignee_id is null and cardinality(d.co_assignee_ids) = 0 and p.role in ('owner','admin') and not p.only_own_tasks))
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

-- ---------------------------------------------------------------------
-- 5. EXCEL İÇE AKTARMA (010'daki sürümün yerine geçer)
--    tasks[] ek alanlar: co_assignees[] (ek sorumlu adları), task_class (Sınıf)
-- ---------------------------------------------------------------------
create or replace function public.import_excel(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me            uuid := public.my_profile_id();
  my_r          text := public.my_role();
  r             jsonb;
  it            jsonb;
  v_project     uuid;
  v_assignee    uuid;
  v_task        uuid;
  v_ex          public.tasks%rowtype;
  v_found       boolean;
  v_pid         uuid;
  v_old_role    text;
  v_new_role    text;
  v_due         date;
  v_co          uuid[];
  v_name        text;
  v_ren         uuid;
  v_ren_name    text;
  renamed       jsonb := '[]';
  v_no          int;
  v_default_time time;
  ins           uuid[] := '{}';
  upd           uuid[] := '{}';
  before_snap   jsonb := '[]';
  i             int;
  people_new    int := 0;
  people_upd    int := 0;
  no_assignee   int := 0;
  batch         uuid := nullif(p->>'batch_id', '')::uuid;
begin
  if not public.is_admin() then
    raise exception 'Excel içe aktarma yetkiniz yok' using errcode = '42501';
  end if;
  if batch is not null and not exists (select 1 from public.import_batches where id = batch and undone_at is null) then
    raise exception 'İçe aktarma oturumu bulunamadı' using errcode = '22023';
  end if;
  perform set_config('app.importing', 'on', true);
  perform pg_advisory_xact_lock(424242);
  select default_due_time into v_default_time from public.app_settings where id = 1;
  select coalesce(max(no), 0) into v_no from public.tasks;

  -- 1) Projeler (sıra = panel sırası).
  --    Dosyadaki ad panelde yoksa ve aynı kod önekli bir proje varsa o proje YENİ ADI alır (aynı proje, yeni ad).
  --    Mevcut projenin türü değiştirilmez; yalnızca yeni açılan projede dosyadan gelen tür kullanılır.
  for r in select * from jsonb_array_elements(coalesce(p->'projects', '[]')) loop
    v_pid := null; v_ren := null;
    select id into v_pid from public.projects where name = r->>'name';
    if v_pid is null and nullif(r->>'code_prefix', '') is not null then
      select id, name into v_ren, v_ren_name from public.projects where upper(code_prefix) = upper(r->>'code_prefix');
      if v_ren is not null and not exists (select 1 from jsonb_array_elements(p->'projects') x where x->>'name' = v_ren_name) then
        update public.projects set name = r->>'name', sort_order = (r->>'sort_order')::int, archived = false where id = v_ren;
        renamed := renamed || jsonb_build_array(jsonb_build_object('from', v_ren_name, 'to', r->>'name'));
        continue;
      end if;
    end if;
    if v_pid is null then
      insert into public.projects (name, type, sort_order, code_prefix)
      values (r->>'name', coalesce(nullif(r->>'type', ''), 'web'), (r->>'sort_order')::int,
              case when exists (select 1 from public.projects where upper(code_prefix) = upper(r->>'code_prefix')) then null
                   else upper(nullif(r->>'code_prefix', '')) end);
    else
      update public.projects set sort_order = (r->>'sort_order')::int, archived = false,
        code_prefix = coalesce(code_prefix, case when exists (select 1 from public.projects where upper(code_prefix) = upper(r->>'code_prefix'))
                                                 then null else upper(nullif(r->>'code_prefix', '')) end)
      where id = v_pid;
    end if;
  end loop;

  -- 2) Listeler: direktörlük / alt birim / fonksiyon / etiket
  for r in select * from jsonb_array_elements(coalesce(p->'lookups', '[]')) loop
    insert into public.lookups (kind, value, sort_order, parent)
    values (r->>'kind', r->>'value', (r->>'sort_order')::int, nullif(r->>'parent', ''))
    on conflict (kind, value) do update set
      sort_order = excluded.sort_order,
      parent = coalesce(excluded.parent, public.lookups.parent);
  end loop;

  -- 3) Kişiler (eski 18 sütunlu dosyanın Kişiler sayfası)
  for r in select * from jsonb_array_elements(coalesce(p->'people', '[]')) loop
    v_pid := null; v_old_role := null;
    if nullif(r->>'email', '') is not null then
      select id, role into v_pid, v_old_role from public.profiles where lower(email) = lower(r->>'email');
    end if;
    if v_pid is null then
      select id, role into v_pid, v_old_role from public.profiles where lower(full_name) = lower(r->>'full_name');
    end if;
    v_new_role := coalesce(nullif(r->>'role', ''), v_old_role, 'member');
    if v_pid is not null and v_pid = me then
      v_new_role := v_old_role;
    elsif my_r <> 'owner' and (v_old_role = 'owner' or v_new_role = 'owner') then
      v_new_role := coalesce(v_old_role, 'member');
      if v_new_role = 'owner' and v_old_role is distinct from 'owner' then v_new_role := 'member'; end if;
    end if;
    if v_pid is null then
      insert into public.profiles (full_name, email, role, phone, language, daily_summary_time,
                                   quiet_hours_start, quiet_hours_end, only_own_tasks)
      values (r->>'full_name', nullif(r->>'email', ''), v_new_role, nullif(r->>'phone', ''),
              coalesce(nullif(r->>'language', ''), 'tr'),
              coalesce((r->>'daily_summary_time')::time, '08:30'),
              (r->>'quiet_hours_start')::time, (r->>'quiet_hours_end')::time,
              coalesce((r->>'only_own_tasks')::boolean, v_new_role = 'member'));
      people_new := people_new + 1;
    else
      update public.profiles set
        full_name          = r->>'full_name',
        email              = coalesce(nullif(r->>'email', ''), email),
        role               = v_new_role,
        phone              = coalesce(nullif(r->>'phone', ''), phone),
        language           = coalesce(nullif(r->>'language', ''), language),
        daily_summary_time = coalesce((r->>'daily_summary_time')::time, daily_summary_time),
        quiet_hours_start  = coalesce((r->>'quiet_hours_start')::time, quiet_hours_start),
        quiet_hours_end    = coalesce((r->>'quiet_hours_end')::time, quiet_hours_end),
        only_own_tasks     = coalesce((r->>'only_own_tasks')::boolean, only_own_tasks)
      where id = v_pid;
      people_upd := people_upd + 1;
    end if;
  end loop;

  -- 4) Görevler: koda (ID) göre eklenir veya güncellenir
  for r in select * from jsonb_array_elements(coalesce(p->'tasks', '[]')) loop
    select id into v_project from public.projects where name = r->>'project';
    if v_project is null then
      insert into public.projects (name, type, sort_order)
      values (r->>'project', coalesce(nullif(r->>'project_type', ''), 'web'),
              coalesce((select max(sort_order) + 1 from public.projects), 1))
      returning id into v_project;
    end if;

    v_assignee := null;
    if nullif(r->>'assignee', '') is not null then
      v_assignee := public.find_profile_by_name(r->>'assignee');
      if v_assignee is null then no_assignee := no_assignee + 1; end if;
    end if;

    -- Ek sorumlular (Excel'de "Hakan / Gamze")
    v_co := '{}';
    for v_name in select jsonb_array_elements_text(coalesce(r->'co_assignees', '[]')) loop
      v_pid := public.find_profile_by_name(v_name);
      if v_pid is null then no_assignee := no_assignee + 1; else v_co := v_co || v_pid; end if;
    end loop;

    select * into v_ex from public.tasks where code = r->>'code';
    v_found := found;
    v_due := (r->>'due_date')::date;

    if v_found then
      if v_due is null and r->>'recurrence' <> 'once' then
        v_due := v_ex.due_date;   -- tekrarlayan görevde panelde ilerlemiş tarih korunur
      end if;
      before_snap := before_snap || jsonb_build_array(jsonb_build_object(
        'task', to_jsonb(v_ex),
        'checklist', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order)
                               from public.checklist_items c where c.task_id = v_ex.id), '[]'::jsonb)));
      update public.tasks set
        project_id       = v_project,
        directorate      = nullif(r->>'directorate', ''),
        section          = r->>'section',
        category         = nullif(r->>'category', ''),
        title            = r->>'title',
        description      = nullif(r->>'description', ''),
        tags             = case when r ? 'tags' then array(select jsonb_array_elements_text(r->'tags')) else v_ex.tags end,
        status           = r->>'status',
        priority         = r->>'priority',
        progress         = coalesce((r->>'progress')::int, 0),
        assignee_id      = case when nullif(r->>'assignee', '') is null then null else coalesce(v_assignee, v_ex.assignee_id) end,
        co_assignee_ids  = case when r ? 'co_assignees' then v_co else v_ex.co_assignee_ids end,
        task_class       = case when r ? 'task_class' then nullif(r->>'task_class', '') else v_ex.task_class end,
        start_date       = (r->>'start_date')::date,
        due_date         = v_due,
        due_time         = coalesce((r->>'due_time')::time, v_ex.due_time),
        completed_at     = case when r->>'status' = 'done'
                                then coalesce(v_ex.completed_at, (r->>'completed_at')::timestamptz) end,
        estimate_minutes = (r->>'estimate_minutes')::int,
        quantity         = coalesce((r->>'quantity')::int, 1),
        recurrence       = r->>'recurrence',
        freq_count       = (r->>'freq_count')::int,
        recurrence_day   = case when r ? 'recurrence_day' then nullif(r->>'recurrence_day', '') else v_ex.recurrence_day end,
        reminder         = coalesce(nullif(r->>'reminder', ''), v_ex.reminder),
        reference_links  = case when r ? 'reference_links'
                                then array(select jsonb_array_elements_text(r->'reference_links')) else v_ex.reference_links end,
        deleted_at       = null
      where id = v_ex.id;
      v_task := v_ex.id;
      upd := upd || v_task;
      if r ? 'checklist' then delete from public.checklist_items where task_id = v_task; end if;
    else
      v_no := v_no + 1;
      insert into public.tasks (no, code, project_id, directorate, section, category, task_class, co_assignee_ids, title, description, tags,
                                status, priority, progress, assignee_id, start_date, due_date, due_time, completed_at,
                                estimate_minutes, quantity, recurrence, freq_count, recurrence_day, reminder, reference_links)
      values (v_no, r->>'code', v_project, nullif(r->>'directorate', ''), r->>'section', nullif(r->>'category', ''),
              nullif(r->>'task_class', ''), v_co,
              r->>'title', nullif(r->>'description', ''),
              array(select jsonb_array_elements_text(coalesce(r->'tags', '[]'))),
              r->>'status', r->>'priority', coalesce((r->>'progress')::int, 0), v_assignee,
              (r->>'start_date')::date, v_due, coalesce((r->>'due_time')::time, v_default_time),
              case when r->>'status' = 'done' then (r->>'completed_at')::timestamptz end,
              (r->>'estimate_minutes')::int, coalesce((r->>'quantity')::int, 1), r->>'recurrence',
              (r->>'freq_count')::int, nullif(r->>'recurrence_day', ''), coalesce(nullif(r->>'reminder', ''), 'none'),
              array(select jsonb_array_elements_text(coalesce(r->'reference_links', '[]'))))
      returning id into v_task;
      ins := ins || v_task;
    end if;

    if r ? 'checklist' then
      i := 0;
      for it in select * from jsonb_array_elements(r->'checklist') loop
        i := i + 1;
        insert into public.checklist_items (task_id, text, note, done, sort_order)
        values (v_task, it->>'text', nullif(it->>'note', ''), coalesce((it->>'done')::boolean, false), i);
      end loop;
    end if;
  end loop;

  -- 5) Oran ve hatırlatma maddelere göre bir kez hesaplanır
  update public.tasks set updated_at = now() where id = any(ins || upd);

  if batch is null then
    insert into public.import_batches (file_name, summary, inserted_task_ids, before_snapshot)
    values (p->>'file_name', '{}'::jsonb, ins, before_snap)
    returning id into batch;
  else
    update public.import_batches set
      inserted_task_ids = inserted_task_ids || ins,
      before_snapshot   = before_snapshot || before_snap
    where id = batch;
  end if;
  update public.import_batches set summary = jsonb_build_object(
      'inserted', cardinality(inserted_task_ids), 'updated', jsonb_array_length(before_snapshot),
      'trashed', cardinality(trashed_task_ids),
      'people_new', coalesce((summary->>'people_new')::int, 0) + people_new,
      'people_updated', coalesce((summary->>'people_updated')::int, 0) + people_upd,
      'no_assignee', coalesce((summary->>'no_assignee')::int, 0) + no_assignee,
      'renamed', coalesce(summary->'renamed', '[]'::jsonb) || renamed)
  where id = batch;

  update public.app_settings set last_activity_at = now() where id = 1;

  return jsonb_build_object('batch_id', batch, 'inserted', cardinality(ins), 'updated', cardinality(upd),
                            'people_new', people_new, 'people_updated', people_upd, 'no_assignee', no_assignee,
                            'renamed', renamed);
end $$;

-- İçe aktarma bitti: etkinlik satırı + görevi kalmayan (bu içe aktarmada boşalan) projeleri arşivle
create or replace function public.import_finish(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; arch uuid[];
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok' using errcode = '42501'; end if;
  select coalesce(array_agg(pr.id), '{}') into arch
  from public.projects pr
  where not pr.archived
    and pr.id in (select (x->'task'->>'project_id')::uuid
                  from public.import_batches b, jsonb_array_elements(b.before_snapshot) x where b.id = p_batch)
    and not exists (select 1 from public.tasks t where t.project_id = pr.id and t.deleted_at is null);
  update public.projects set archived = true where id = any(arch);
  update public.import_batches set summary = summary || jsonb_build_object('archived_projects', to_jsonb(arch))
   where id = p_batch;
  select summary into s from public.import_batches where id = p_batch;
  insert into public.activity_log (entity, entity_id, action, changes, profile_id)
  values ('import', p_batch, 'import',
          jsonb_build_object('file', (select file_name from public.import_batches where id = p_batch)) || coalesce(s, '{}'),
          public.my_profile_id());
  return s;
end $$;

-- Geri al: eklenenleri siler, güncellenenleri eski haline, çöpe taşınanları geri getirir
create or replace function public.undo_import(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b   public.import_batches%rowtype;
  r   jsonb;
  ids uuid[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'Bu işlem için yetkiniz yok' using errcode = '42501';
  end if;
  select * into b from public.import_batches where id = p_batch;
  if not found or b.undone_at is not null then
    raise exception 'Bu içe aktarma bulunamadı veya zaten geri alındı';
  end if;
  if exists (select 1 from public.import_batches where created_at > b.created_at and undone_at is null) then
    raise exception 'Yalnızca en son içe aktarma geri alınabilir';
  end if;

  perform set_config('app.importing', 'on', true);

  delete from public.tasks where id = any(b.inserted_task_ids);
  update public.tasks set deleted_at = null where id = any(b.trashed_task_ids);

  for r in select * from jsonb_array_elements(b.before_snapshot) loop
    update public.tasks x set
      project_id = s.project_id, code = s.code, directorate = s.directorate, section = s.section,
      category = s.category, title = s.title, description = s.description, tags = s.tags, status = s.status,
      priority = s.priority, progress = s.progress, assignee_id = s.assignee_id, start_date = s.start_date,
      due_date = s.due_date, due_time = s.due_time, estimate_minutes = s.estimate_minutes,
      quantity = coalesce(s.quantity, 1), freq_count = s.freq_count, recurrence = s.recurrence,
      recurrence_day = s.recurrence_day, reminder = s.reminder, reference_links = s.reference_links,
      completed_at = s.completed_at, deleted_at = s.deleted_at,
      co_assignee_ids = coalesce(s.co_assignee_ids, '{}'), task_class = s.task_class
    from jsonb_populate_record(null::public.tasks, r->'task') s
    where x.id = s.id;
    if r ? 'checklist' then
      delete from public.checklist_items where task_id = (r->'task'->>'id')::uuid;
      insert into public.checklist_items
        select * from jsonb_populate_recordset(null::public.checklist_items, r->'checklist');
    end if;
    ids := ids || (r->'task'->>'id')::uuid;
  end loop;

  update public.tasks set updated_at = now() where id = any(ids || b.trashed_task_ids);
  -- İçe aktarmada arşive alınan projeler geri açılır
  update public.projects set archived = false
   where id in (select jsonb_array_elements_text(coalesce(b.summary->'archived_projects', '[]'))::uuid);
  update public.import_batches set undone_at = now() where id = p_batch;

  insert into public.activity_log (entity, entity_id, action, changes, profile_id)
  values ('import', p_batch, 'delete', jsonb_build_object('undo', true), public.my_profile_id());

  return jsonb_build_object('deleted', cardinality(b.inserted_task_ids), 'restored', cardinality(ids),
                            'untrashed', cardinality(b.trashed_task_ids));
end $$;

revoke execute on function public.import_excel(jsonb)  from anon, public;
revoke execute on function public.undo_import(uuid)    from anon, public;
revoke execute on function public.import_finish(uuid)  from anon, public;
grant  execute on function public.import_excel(jsonb)  to authenticated;
grant  execute on function public.undo_import(uuid)    to authenticated;
grant  execute on function public.import_finish(uuid)  to authenticated;

-- ---------------------------------------------------------------------
-- 6. TOPLU İŞLEM: ek sorumlu ekleme ve Sınıf (010'daki sürümün yerine geçer)
-- ---------------------------------------------------------------------
create or replace function public.bulk_update_tasks(p_ids uuid[], p_patch jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok' using errcode = '42501'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then return 0; end if;
  if cardinality(p_ids) > 5000 then raise exception 'Tek seferde en fazla 5000 görev' using errcode = '22023'; end if;
  update public.tasks set
    assignee_id = case when p_patch ? 'assignee_id' then nullif(p_patch->>'assignee_id', '')::uuid else assignee_id end,
    co_assignee_ids = case
      when p_patch ? 'add_co_assignee' and nullif(p_patch->>'add_co_assignee', '') is not null
        then co_assignee_ids || (p_patch->>'add_co_assignee')::uuid
      when p_patch ? 'clear_co_assignees' then '{}'
      else co_assignee_ids end,
    priority    = case when p_patch ? 'priority'    then p_patch->>'priority' else priority end,
    status      = case when p_patch ? 'status'      then p_patch->>'status' else status end,
    due_date    = case when p_patch ? 'due_date'    then nullif(p_patch->>'due_date', '')::date else due_date end,
    reminder    = case when p_patch ? 'reminder'    then p_patch->>'reminder' else reminder end,
    directorate = case when p_patch ? 'directorate' then nullif(p_patch->>'directorate', '') else directorate end,
    task_class  = case when p_patch ? 'task_class'  then nullif(p_patch->>'task_class', '') else task_class end
  where id = any(p_ids) and deleted_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.bulk_update_tasks(uuid[], jsonb) from public, anon;
grant  execute on function public.bulk_update_tasks(uuid[], jsonb) to authenticated;

notify pgrst, 'reload schema';
