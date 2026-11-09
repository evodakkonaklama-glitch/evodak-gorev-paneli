-- =====================================================================
-- Evodak Görev Takip Paneli – 007_son.sql  (6. aşama)
-- 1) Şablondan yeni proje oluşturma
-- 2) Yönetici (owner) korumaları
-- 3) Yedek deposu (özel) ve erişim kuralı
-- 4) Gece bakımı: 30 günü geçen çöpü temizler, haftalık yedek alır
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Yeni proje + görevleri tek seferde oluştur (owner/admin)
--    p = { name, type, tasks: [{ section, category, title, description,
--          checklist:[{text,note}], estimate_minutes, recurrence, recurrence_day,
--          reminder, priority, tags:[], assignee_id, start_date, due_date }] }
-- ---------------------------------------------------------------------
create or replace function public.create_project(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_project uuid; v_task uuid; v_no int; r jsonb; it jsonb; i int; n int := 0;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_type text := p->>'type';
  ids uuid[] := '{}';
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'Proje adı boş olamaz' using errcode = '22023'; end if;
  if v_type not in ('web','panel','is_plani') then raise exception 'Geçersiz proje türü' using errcode = '22023'; end if;
  if exists (select 1 from public.projects where lower(name) = lower(v_name)) then
    raise exception 'Bu adla bir proje zaten var' using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(424242);   -- görev numaraları çakışmasın
  insert into public.projects (name, type, sort_order)
  values (v_name, v_type, coalesce((select max(sort_order) from public.projects), 0) + 1)
  returning id into v_project;

  select coalesce(max(no), 0) into v_no from public.tasks;
  perform set_config('app.importing', 'on', true);   -- madde başına geçmiş kaydı yazılmasın

  for r in select * from jsonb_array_elements(coalesce(p->'tasks', '[]')) loop
    v_no := v_no + 1;
    insert into public.lookups (kind, value, sort_order)
    select 'section', r->>'section', coalesce((select max(sort_order) from public.lookups where kind = 'section'), 0) + 1
    where nullif(r->>'section', '') is not null
      and not exists (select 1 from public.lookups where kind = 'section' and lower(value) = lower(r->>'section'));

    insert into public.tasks (no, project_id, section, category, title, description, tags, status, priority,
                              assignee_id, start_date, due_date, estimate_minutes, recurrence, recurrence_day, reminder)
    values (v_no, v_project, coalesce(nullif(r->>'section', ''), 'Genel'), nullif(r->>'category', ''), r->>'title',
            nullif(r->>'description', ''), array(select jsonb_array_elements_text(coalesce(r->'tags', '[]'))),
            'todo', coalesce(nullif(r->>'priority', ''), 'medium'),
            nullif(r->>'assignee_id', '')::uuid, nullif(r->>'start_date', '')::date, nullif(r->>'due_date', '')::date,
            nullif(r->>'estimate_minutes', '')::int, coalesce(nullif(r->>'recurrence', ''), 'once'),
            nullif(r->>'recurrence_day', ''), coalesce(nullif(r->>'reminder', ''), 'none'))
    returning id into v_task;
    ids := ids || v_task;
    insert into public.activity_log (entity, entity_id, task_id, action, changes, profile_id)
    values ('tasks', v_task, v_task, 'insert', jsonb_build_object('template', true), public.my_profile_id());

    i := 0;
    for it in select * from jsonb_array_elements(coalesce(r->'checklist', '[]')) loop
      i := i + 1;
      insert into public.checklist_items (task_id, text, note, done, sort_order)
      values (v_task, it->>'text', nullif(it->>'note', ''), false, i);
    end loop;
    n := n + 1;
  end loop;

  update public.tasks set updated_at = now() where id = any(ids);   -- oran ve hatırlatma bir kez hesaplanır
  perform set_config('app.importing', '', true);

  insert into public.activity_log (entity, entity_id, action, changes, profile_id)
  values ('projects', v_project, 'insert', jsonb_build_object('name', v_name, 'tasks', n), public.my_profile_id());

  return jsonb_build_object('project_id', v_project, 'tasks', n);
end $$;
revoke execute on function public.create_project(jsonb) from public, anon;
grant  execute on function public.create_project(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Owner korumaları: son owner rolünü kaybedemez / pasif yapılamaz
-- ---------------------------------------------------------------------
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'owner' and (new.role <> 'owner' or not new.active)
     and not exists (select 1 from public.profiles where role = 'owner' and active and id <> old.id) then
    raise exception 'Panelde en az bir yönetici (owner) kalmalı' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update of role, active on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ---------------------------------------------------------------------
-- 3. Yedek deposu: özel; yalnızca owner/admin indirebilir, yalnızca sunucu yazar
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 52428800)
on conflict (id) do update set public = false;

drop policy if exists evodak_backups_read on storage.objects;
create policy evodak_backups_read on storage.objects for select to authenticated
  using (bucket_id = 'backups' and public.is_admin());

-- Dosya alanı göstergesi yalnızca görev dosyalarını saysın
create or replace function public.storage_usage() returns jsonb
language sql stable security definer set search_path = public, storage as $$
  select jsonb_build_object(
    'bytes', coalesce(sum((o.metadata->>'size')::bigint), 0),
    'files', count(*) filter (where o.bucket_id = 'files'),
    'backup_bytes', coalesce(sum((o.metadata->>'size')::bigint) filter (where o.bucket_id = 'backups'), 0))
  from storage.objects o
  where public.is_team()
$$;

-- ---------------------------------------------------------------------
-- 4. Gece bakımı (her gece 03:30, Türkiye saati)
-- ---------------------------------------------------------------------
select cron.unschedule(jobname) from cron.job where jobname = 'maintenance';
select cron.schedule('maintenance', '30 0 * * *', $job$
  select net.http_post(
    url := 'https://znmeghdcyrarfpkuxtvp.supabase.co/functions/v1/maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_eRXjy8MMFBk_k_AL1H4koQ_jHdJX9NU',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"mode":"daily"}'::jsonb,
    timeout_milliseconds := 120000)
$job$);

-- Kontrol: üç zamanlanmış iş ve yedek deposu görünmeli
select jobname, schedule from cron.job order by jobname;
