-- =====================================================================
-- Evodak Görev Takip Paneli – 002_import.sql
-- Excel içe aktarma ve geri alma (tek işlemde: ya hepsi yazılır ya hiçbiri)
-- 001_schema.sql'den SONRA çalıştırın.
-- =====================================================================

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
  v_default_time time;
  ins           uuid[] := '{}';
  upd           uuid[] := '{}';
  before_snap   jsonb := '[]';
  i             int;
  people_new    int := 0;
  people_upd    int := 0;
  tpl_count     int := 0;
  batch         uuid;
begin
  if not public.is_admin() then
    raise exception 'Excel içe aktarma yetkiniz yok' using errcode = '42501';
  end if;
  perform set_config('app.importing', 'on', true);
  select default_due_time into v_default_time from public.app_settings where id = 1;

  -- 1) Projeler (Listeler sırası = panel sırası)
  for r in select * from jsonb_array_elements(coalesce(p->'projects', '[]')) loop
    insert into public.projects (name, type, sort_order)
    values (r->>'name', r->>'type', (r->>'sort_order')::int)
    on conflict (name) do update set sort_order = excluded.sort_order;
  end loop;

  -- 2) Bölüm / Kategori / Etiket listeleri
  for r in select * from jsonb_array_elements(coalesce(p->'lookups', '[]')) loop
    insert into public.lookups (kind, value, sort_order)
    values (r->>'kind', r->>'value', (r->>'sort_order')::int)
    on conflict (kind, value) do update set sort_order = excluded.sort_order;
  end loop;

  -- 3) Kişiler: önce e-postaya, yoksa ada göre eşlenir
  for r in select * from jsonb_array_elements(coalesce(p->'people', '[]')) loop
    v_pid := null; v_old_role := null;
    if nullif(r->>'email', '') is not null then
      select id, role into v_pid, v_old_role from public.profiles where lower(email) = lower(r->>'email');
    end if;
    if v_pid is null then
      select id, role into v_pid, v_old_role from public.profiles where lower(full_name) = lower(r->>'full_name');
    end if;

    -- owner rolünü yalnızca owner verebilir/alabilir; kişi kendi rolünü değiştiremez
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

  -- 4) Görevler: NO'ya göre eklenir veya güncellenir
  for r in select * from jsonb_array_elements(coalesce(p->'tasks', '[]')) loop
    select id into v_project from public.projects where name = r->>'project';
    if v_project is null then
      insert into public.projects (name, type, sort_order)
      values (r->>'project', coalesce(r->>'project_type', 'web'),
              coalesce((select max(sort_order) + 1 from public.projects), 1))
      returning id into v_project;
    end if;

    v_assignee := null;
    if nullif(r->>'assignee', '') is not null then
      select id into v_assignee from public.profiles where lower(full_name) = lower(r->>'assignee');
      if v_assignee is null then
        raise exception 'NO %: sorumlu kişi bulunamadı (%)', r->>'no', r->>'assignee';
      end if;
    end if;

    select * into v_ex from public.tasks where no = (r->>'no')::int;
    v_found := found;
    v_due := (r->>'due_date')::date;

    if v_found then
      -- Tekrarlayan görevde Excel'de tarih yoksa panelde ilerlemiş tarih korunur
      if v_due is null and r->>'recurrence' <> 'once' and r->>'start_date' is not distinct from v_ex.start_date::text then
        v_due := v_ex.due_date;
      end if;
      before_snap := before_snap || jsonb_build_array(jsonb_build_object(
        'task', to_jsonb(v_ex),
        'checklist', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order)
                               from public.checklist_items c where c.task_id = v_ex.id), '[]'::jsonb)));
      update public.tasks set
        project_id       = v_project,
        section          = r->>'section',
        category         = nullif(r->>'category', ''),
        title            = r->>'title',
        description      = nullif(r->>'description', ''),
        tags             = array(select jsonb_array_elements_text(coalesce(r->'tags', '[]'))),
        status           = r->>'status',
        priority         = r->>'priority',
        assignee_id      = v_assignee,
        start_date       = (r->>'start_date')::date,
        due_date         = v_due,
        due_time         = coalesce((r->>'due_time')::time, v_ex.due_time),
        estimate_minutes = (r->>'estimate_minutes')::int,
        recurrence       = r->>'recurrence',
        recurrence_day   = nullif(r->>'recurrence_day', ''),
        reminder         = r->>'reminder',
        reference_links  = array(select jsonb_array_elements_text(coalesce(r->'reference_links', '[]'))),
        deleted_at       = null
      where id = v_ex.id;
      v_task := v_ex.id;
      upd := upd || v_task;
      delete from public.checklist_items where task_id = v_task;
    else
      insert into public.tasks (no, project_id, section, category, title, description, tags, status, priority,
                                assignee_id, start_date, due_date, due_time, estimate_minutes, recurrence,
                                recurrence_day, reminder, reference_links)
      values ((r->>'no')::int, v_project, r->>'section', nullif(r->>'category', ''), r->>'title',
              nullif(r->>'description', ''),
              array(select jsonb_array_elements_text(coalesce(r->'tags', '[]'))),
              r->>'status', r->>'priority', v_assignee,
              (r->>'start_date')::date, v_due, coalesce((r->>'due_time')::time, v_default_time),
              (r->>'estimate_minutes')::int, r->>'recurrence', nullif(r->>'recurrence_day', ''), r->>'reminder',
              array(select jsonb_array_elements_text(coalesce(r->'reference_links', '[]'))))
      returning id into v_task;
      ins := ins || v_task;
    end if;

    i := 0;
    for it in select * from jsonb_array_elements(coalesce(r->'checklist', '[]')) loop
      i := i + 1;
      insert into public.checklist_items (task_id, text, note, done, sort_order)
      values (v_task, it->>'text', nullif(it->>'note', ''), coalesce((it->>'done')::boolean, false), i);
    end loop;
  end loop;

  -- 5) Oran ve hatırlatma zamanı maddelere göre bir kez hesaplanır
  update public.tasks set updated_at = now() where id = any(ins || upd);

  -- 6) Şablonlar yalnızca henüz şablon yoksa oluşturulur (sonra Ayarlar'dan düzenlenir)
  if not exists (select 1 from public.task_templates) then
    for r in select * from jsonb_array_elements(coalesce(p->'templates', '[]')) loop
      insert into public.task_templates (project_type, sort_order, section, category, title, description,
                                         estimate_minutes, recurrence, recurrence_day, reminder, priority, tags)
      values (r->>'project_type', (r->>'sort_order')::int, r->>'section', nullif(r->>'category', ''), r->>'title',
              nullif(r->>'description', ''), (r->>'estimate_minutes')::int, r->>'recurrence',
              nullif(r->>'recurrence_day', ''), r->>'reminder', r->>'priority',
              array(select jsonb_array_elements_text(coalesce(r->'tags', '[]'))));
      tpl_count := tpl_count + 1;
    end loop;
  end if;

  insert into public.import_batches (file_name, summary, inserted_task_ids, before_snapshot)
  values (p->>'file_name',
          jsonb_build_object('inserted', cardinality(ins), 'updated', cardinality(upd),
                             'people_new', people_new, 'people_updated', people_upd, 'templates', tpl_count),
          ins, before_snap)
  returning id into batch;

  insert into public.activity_log (entity, entity_id, action, changes, profile_id)
  values ('import', batch, 'import',
          jsonb_build_object('file', p->>'file_name', 'inserted', cardinality(ins), 'updated', cardinality(upd)), me);

  update public.app_settings set last_activity_at = now() where id = 1;

  return jsonb_build_object('batch_id', batch, 'inserted', cardinality(ins), 'updated', cardinality(upd),
                            'people_new', people_new, 'people_updated', people_upd, 'templates', tpl_count);
end $$;

-- Son içe aktarmayı geri al
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

  for r in select * from jsonb_array_elements(b.before_snapshot) loop
    update public.tasks x set
      project_id = s.project_id, section = s.section, category = s.category, title = s.title,
      description = s.description, tags = s.tags, status = s.status, priority = s.priority,
      assignee_id = s.assignee_id, start_date = s.start_date, due_date = s.due_date, due_time = s.due_time,
      estimate_minutes = s.estimate_minutes, recurrence = s.recurrence, recurrence_day = s.recurrence_day,
      reminder = s.reminder, reference_links = s.reference_links, completed_at = s.completed_at,
      deleted_at = s.deleted_at
    from jsonb_populate_record(null::public.tasks, r->'task') s
    where x.id = s.id;
    delete from public.checklist_items where task_id = (r->'task'->>'id')::uuid;
    insert into public.checklist_items
      select * from jsonb_populate_recordset(null::public.checklist_items, r->'checklist');
    ids := ids || (r->'task'->>'id')::uuid;
  end loop;

  update public.tasks set updated_at = now() where id = any(ids);
  update public.import_batches set undone_at = now() where id = p_batch;

  insert into public.activity_log (entity, entity_id, action, changes, profile_id)
  values ('import', p_batch, 'delete', jsonb_build_object('undo', true), public.my_profile_id());

  return jsonb_build_object('deleted', cardinality(b.inserted_task_ids), 'restored', cardinality(ids));
end $$;

revoke execute on function public.import_excel(jsonb) from anon, public;
revoke execute on function public.undo_import(uuid)   from anon, public;
grant  execute on function public.import_excel(jsonb) to authenticated;
grant  execute on function public.undo_import(uuid)   to authenticated;
