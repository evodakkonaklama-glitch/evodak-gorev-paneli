-- =====================================================================
-- Evodak Görev Takip Paneli – 010_era.sql  (Paket 9: ERA Excel uyarlaması)
-- 009_google_plan.sql'den SONRA, Supabase → SQL Editor'de bir kez çalıştırın.
-- Tekrar çalıştırılırsa zarar vermez.
--
-- 1) Yeni alanlar: görev kodu (ID), direktörlük, adet, sıklık sayısı, proje kod öneki
-- 2) "Engellendi" durumu kalkar (Beklemede'ye taşınır); yeni proje türleri
-- 3) Tekrarda birden çok gün (haftalık: mon,thu · aylık: 1,15 · yıllık: 03-01,09-01)
-- 4) Görev tetikleyicisi: kod üretimi, elle ilerleme, Excel'den gelen bitiş tarihi
-- 5) Parçalı Excel içe aktarma (aynı işlemde 500'erli), tam değiştirme, geri al
-- 6) Toplu işlem, şablonları yeniden oluşturma, yeni proje (kod önekiyle)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ALANLAR
-- ---------------------------------------------------------------------
alter table public.tasks add column if not exists code        text;
alter table public.tasks add column if not exists directorate text;
alter table public.tasks add column if not exists quantity    int;
alter table public.tasks add column if not exists freq_count  int;

alter table public.projects       add column if not exists code_prefix text;
alter table public.lookups        add column if not exists parent      text;
alter table public.task_templates add column if not exists directorate text;
alter table public.task_templates add column if not exists quantity    int;
alter table public.task_templates add column if not exists freq_count  int;
alter table public.import_batches add column if not exists trashed_task_ids uuid[] not null default '{}';

update public.tasks set code = '#' || no where code is null;
update public.tasks set quantity = 1 where quantity is null;
alter table public.tasks alter column code set not null;
alter table public.tasks alter column quantity set default 1;
alter table public.tasks alter column quantity set not null;
create unique index if not exists tasks_code_key on public.tasks (code);
create unique index if not exists projects_code_prefix_key on public.projects (upper(code_prefix)) where code_prefix is not null;
create index if not exists tasks_directorate_idx on public.tasks (directorate) where deleted_at is null;

alter table public.tasks drop constraint if exists tasks_quantity_check;
alter table public.tasks add  constraint tasks_quantity_check check (quantity between 1 and 10000);
alter table public.tasks drop constraint if exists tasks_freq_count_check;
alter table public.tasks add  constraint tasks_freq_count_check check (freq_count is null or freq_count between 0 and 31);

-- "Engellendi" kalkar
update public.tasks set status = 'waiting' where status = 'blocked';
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add  constraint tasks_status_check
  check (status in ('todo','in_progress','waiting','done','cancelled'));

-- Yeni proje türleri: Program (ör. Organizasyon Çalışma Programı), Birim İşleri
alter table public.projects drop constraint if exists projects_type_check;
alter table public.projects add  constraint projects_type_check
  check (type in ('web','panel','is_plani','program','birim'));

-- Listelere Direktörlük eklenir
alter table public.lookups drop constraint if exists lookups_kind_check;
alter table public.lookups add  constraint lookups_kind_check
  check (kind in ('directorate','section','category','tag'));

-- ---------------------------------------------------------------------
-- 2. TEKRAR: birden çok gün
--    weekly : 'mon' veya 'mon,thu'      monthly: '15' veya '1,15'
--    yearly : boş (başlangıç günü) veya '03-01,09-01' (AA-GG)
-- ---------------------------------------------------------------------
create or replace function public.next_occurrence(p_from date, p_rule text, p_day text, p_inclusive boolean default false)
returns date language plpgsql immutable as $$
declare
  d date := case when p_inclusive then p_from else p_from + 1 end;
  parts text[];
  dows int[] := '{}';
  doms int[] := '{}';
  x text; m date; last_day int; k int; best date; cand date; y int;
begin
  if p_from is null or p_rule = 'once' then return null; end if;
  parts := array(select btrim(v) from unnest(string_to_array(lower(coalesce(p_day, '')), ',')) v where btrim(v) <> '');

  if p_rule = 'daily' then
    return d;
  elsif p_rule = 'weekdays' then
    while extract(isodow from d) > 5 loop d := d + 1; end loop;
    return d;
  elsif p_rule = 'weekly' then
    foreach x in array parts loop
      dows := dows || case x when 'mon' then 1 when 'tue' then 2 when 'wed' then 3 when 'thu' then 4
                             when 'fri' then 5 when 'sat' then 6 when 'sun' then 7 else null end;
    end loop;
    dows := array_remove(dows, null);
    if cardinality(dows) = 0 then dows := array[extract(isodow from p_from)::int]; end if;
    for k in 0..6 loop
      if extract(isodow from d + k)::int = any(dows) then return d + k; end if;
    end loop;
    return d;
  elsif p_rule = 'monthly' then
    foreach x in array parts loop
      if x ~ '^\d{1,2}$' and x::int between 1 and 31 then doms := doms || x::int; end if;
    end loop;
    if cardinality(doms) = 0 then doms := array[extract(day from p_from)::int]; end if;
    m := date_trunc('month', d)::date;
    loop
      last_day := extract(day from (m + interval '1 month - 1 day'))::int;
      best := null;
      foreach k in array doms loop
        cand := m + (least(k, last_day) - 1);
        if cand >= d and (best is null or cand < best) then best := cand; end if;
      end loop;
      if best is not null then return best; end if;
      m := (m + interval '1 month')::date;
    end loop;
  elsif p_rule = 'yearly' then
    if cardinality(parts) = 0 then
      m := p_from;
      while m < d loop m := (m + interval '1 year')::date; end loop;
      return m;
    end if;
    best := null;
    for y in extract(year from d)::int .. extract(year from d)::int + 1 loop
      foreach x in array parts loop
        if x ~ '^\d{1,2}-\d{1,2}$' then
          begin
            cand := make_date(y, split_part(x, '-', 1)::int, least(split_part(x, '-', 2)::int,
                      extract(day from (make_date(y, split_part(x, '-', 1)::int, 1) + interval '1 month - 1 day'))::int));
            if cand >= d and (best is null or cand < best) then best := cand; end if;
          exception when others then null;
          end;
        end if;
      end loop;
      exit when best is not null;
    end loop;
    return coalesce(best, (p_from + interval '1 year')::date);
  end if;
  return null;
end $$;

-- Başlangıç tarihi geçmişte kalmış tekrarlayan görev: kuralın gününü (haftanın günü, ayın günü,
-- yılın günü) başlangıçtan alıp bugün veya sonrasındaki ilk tekrarı bulur.
create or replace function public.first_occurrence_from_today(p_start date, p_rule text, p_day text)
returns date language plpgsql stable as $$
declare
  today date := (now() at time zone 'Europe/Istanbul')::date;
  d date;
  anchor text := nullif(btrim(coalesce(p_day, '')), '');
begin
  if p_rule = 'once' or p_start is null then return null; end if;
  d := public.next_occurrence(p_start, p_rule, p_day, true);
  if d >= today then return d; end if;
  if anchor is null then
    anchor := case p_rule
      when 'weekly'  then (array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from p_start)::int]
      when 'monthly' then extract(day from p_start)::int::text
      when 'yearly'  then to_char(p_start, 'MM-DD')
      else null end;
  end if;
  return public.next_occurrence(today, p_rule, anchor, true);
end $$;

-- ---------------------------------------------------------------------
-- 3. GÖREV KODU üretimi: PREFIX-001 biçiminde, önekteki en büyük sayının bir fazlası
-- ---------------------------------------------------------------------
create or replace function public.next_task_code(p_project uuid) returns text
language plpgsql security definer set search_path = public as $$
declare pre text; mx int; w int;
begin
  select upper(nullif(btrim(code_prefix), '')) into pre from public.projects where id = p_project;
  if pre is null then return null; end if;
  perform pg_advisory_xact_lock(hashtext('task_code:' || pre));
  select max(substring(code from '^' || pre || '-(\d+)$')::int),
         max(length(substring(code from '^' || pre || '-(\d+)$')))
    into mx, w
  from public.tasks where code ~ ('^' || pre || '-\d+$');
  return pre || '-' || lpad((coalesce(mx, 0) + 1)::text, greatest(coalesce(w, 3), 3), '0');
end $$;
revoke execute on function public.next_task_code(uuid) from public, anon;
grant  execute on function public.next_task_code(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. GÖREV TETİKLEYİCİSİ (006'daki sürümün yerine geçer)
-- ---------------------------------------------------------------------
create or replace function public.tg_tasks_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  total int; finished int;
  base date; nxt date; today date := (now() at time zone 'Europe/Istanbul')::date;
  prev_flag text;
  snap jsonb;
begin
  -- Üye görevi başkasına atayamaz / projesini veya kodunu değiştiremez
  if tg_op = 'UPDATE' and public.my_role() = 'member'
     and (new.assignee_id is distinct from old.assignee_id or new.project_id is distinct from old.project_id
          or new.no is distinct from old.no or new.code is distinct from old.code) then
    raise exception 'Bu alanı değiştirme yetkiniz yok' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then new.version := old.version + 1; end if;

  -- Kod ve adet varsayılanları (eski yedeklerden gelen kayıtlar dahil)
  new.quantity := greatest(coalesce(new.quantity, 1), 1);
  if nullif(btrim(coalesce(new.code, '')), '') is null then
    -- Yedekten/eski dosyadan gelen kodsuz kayıt eski numarasını korur (#12); panelden yeni görev proje önekini alır
    new.code := case when coalesce(current_setting('app.importing', true), '') = 'on' then '#' || new.no
                     else coalesce(public.next_task_code(new.project_id), '#' || new.no) end;
  else
    new.code := btrim(new.code);
  end if;
  if new.status = 'blocked' then new.status := 'waiting'; end if;

  -- Tekrarlayan görevde termin yoksa ilk tekrar: başlangıç tarihinin kuralına göre bugün veya sonrasındaki ilk gün.
  -- Başlangıç tarihi olmayan tekrarlayan görev (Excel'deki tarihsiz rutinler) tarihsiz kalır; başlangıç girilince planlanır.
  if new.recurrence <> 'once' and new.due_date is null and new.start_date is not null then
    new.due_date := public.first_occurrence_from_today(new.start_date, new.recurrence, new.recurrence_day);
  end if;

  -- TEKRAR DÖNGÜSÜ: tekrarlayan görev "Tamamlandı" olunca sıradaki tekrara geç
  if tg_op = 'UPDATE' and new.recurrence <> 'once' and new.status = 'done' and old.status <> 'done'
     and new.deleted_at is null and coalesce(current_setting('app.importing', true), '') <> 'on' then
    base := coalesce(old.due_date, new.due_date, today);
    nxt := public.next_occurrence(base, new.recurrence, new.recurrence_day, false);
    if nxt is not null and nxt < today then
      nxt := public.next_occurrence(today, new.recurrence, new.recurrence_day, true);
    end if;
    if nxt is not null then
      select coalesce(jsonb_agg(jsonb_build_object('text', text, 'note', note, 'done', done) order by sort_order), '[]')
        into snap from public.checklist_items where task_id = new.id;
      insert into public.task_occurrences (task_id, occurrence_date, completed_by, checklist_snapshot)
      values (new.id, base, public.my_profile_id(), snap);

      prev_flag := current_setting('app.importing', true);
      perform set_config('app.importing', 'on', true);
      update public.checklist_items set done = false where task_id = new.id and done;
      perform set_config('app.importing', coalesce(prev_flag, ''), true);

      insert into public.activity_log (entity, entity_id, task_id, action, changes, profile_id)
      values ('tasks', new.id, new.id, 'complete_occurrence',
              jsonb_build_object('occurrence', base, 'next', nxt), public.my_profile_id());

      new.due_date := nxt;
      new.status := 'todo';
      new.completed_at := null;
      new.progress := 0;
    end if;
  end if;

  -- İlerleme: maddesi varsa maddelerden; yoksa Tamamlandı 100, Devam Ediyor elle (0–100), diğerleri 0
  select count(*), count(*) filter (where done) into total, finished
  from public.checklist_items where task_id = new.id;
  if total > 0 then
    new.progress := round(finished * 100.0 / total);
  elsif new.status = 'done' then
    new.progress := 100;
  elsif new.status in ('in_progress', 'waiting') then
    new.progress := least(greatest(coalesce(new.progress, 0), 0), 99);
  else
    new.progress := 0;
  end if;

  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  new.next_reminder_at := case
    when new.deleted_at is not null or new.status in ('done','cancelled') then null
    else public.compute_remind_at(new.due_date, new.due_time, new.reminder)
  end;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. EXCEL İÇE AKTARMA (ERA ve eski 18 sütun; parçalı)
--    p: { file_name, batch_id (2. parçadan itibaren), projects[], lookups[], people[], tasks[] }
--    tasks[]: code, project, directorate, section, category, title, description, tags[], status,
--             priority, progress, assignee, start_date, due_date, due_time, completed_at, estimate_minutes,
--             quantity, recurrence, freq_count, recurrence_day, reminder, reference_links[], checklist[]
--             (alan hiç gönderilmezse mevcut değer korunur: reminder, tags, reference_links, recurrence_day)
-- ---------------------------------------------------------------------
create or replace function public.find_profile_by_name(p_name text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.profiles where lower(full_name) = lower(btrim(p_name)) limit 1),
    (select min(id::text)::uuid from public.profiles
      where lower(split_part(full_name, ' ', 1)) = lower(btrim(p_name))
      having count(*) = 1)
  )
$$;

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

  -- 1) Projeler (sıra = panel sırası; kod öneki boşsa korunur)
  for r in select * from jsonb_array_elements(coalesce(p->'projects', '[]')) loop
    insert into public.projects (name, type, sort_order, code_prefix)
    values (r->>'name', coalesce(nullif(r->>'type', ''), 'web'), (r->>'sort_order')::int, upper(nullif(r->>'code_prefix', '')))
    on conflict (name) do update set
      sort_order  = excluded.sort_order,
      code_prefix = coalesce(public.projects.code_prefix, excluded.code_prefix),
      type        = case when r ? 'type' and nullif(r->>'type', '') is not null then excluded.type else public.projects.type end;
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
      insert into public.tasks (no, code, project_id, directorate, section, category, title, description, tags,
                                status, priority, progress, assignee_id, start_date, due_date, due_time, completed_at,
                                estimate_minutes, quantity, recurrence, freq_count, recurrence_day, reminder, reference_links)
      values (v_no, r->>'code', v_project, nullif(r->>'directorate', ''), r->>'section', nullif(r->>'category', ''),
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
      'no_assignee', coalesce((summary->>'no_assignee')::int, 0) + no_assignee)
  where id = batch;

  update public.app_settings set last_activity_at = now() where id = 1;

  return jsonb_build_object('batch_id', batch, 'inserted', cardinality(ins), 'updated', cardinality(upd),
                            'people_new', people_new, 'people_updated', people_upd, 'no_assignee', no_assignee);
end $$;

-- Tam değiştirme: dosyada olmayan görevleri çöp kutusuna taşır (yalnızca owner; son parçadan sonra)
create or replace function public.import_trash_missing(p_batch uuid, p_codes text[]) returns int
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; n int;
begin
  if public.my_role() <> 'owner' then raise exception 'Bu işlem yalnızca yönetici (owner) içindir' using errcode = '42501'; end if;
  if not exists (select 1 from public.import_batches where id = p_batch and undone_at is null) then
    raise exception 'İçe aktarma oturumu bulunamadı' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_codes), 0) = 0 then raise exception 'Dosyada görev yok' using errcode = '22023'; end if;
  perform set_config('app.importing', 'on', true);
  select coalesce(array_agg(id), '{}') into ids from public.tasks
   where deleted_at is null and not (code = any(p_codes));
  update public.tasks set deleted_at = now() where id = any(ids);
  n := cardinality(ids);
  update public.import_batches set trashed_task_ids = trashed_task_ids || ids,
         summary = summary || jsonb_build_object('trashed', cardinality(trashed_task_ids) + n)
   where id = p_batch;
  insert into public.activity_log (entity, entity_id, action, changes, profile_id)
  values ('import', p_batch, 'delete', jsonb_build_object('trashed', n), public.my_profile_id());
  return n;
end $$;

-- İçe aktarma kaydının etkinlik satırı (tüm parçalar bitince bir kez)
create or replace function public.import_finish(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok' using errcode = '42501'; end if;
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
      completed_at = s.completed_at, deleted_at = s.deleted_at
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
  update public.import_batches set undone_at = now() where id = p_batch;

  insert into public.activity_log (entity, entity_id, action, changes, profile_id)
  values ('import', p_batch, 'delete', jsonb_build_object('undo', true), public.my_profile_id());

  return jsonb_build_object('deleted', cardinality(b.inserted_task_ids), 'restored', cardinality(ids),
                            'untrashed', cardinality(b.trashed_task_ids));
end $$;

revoke execute on function public.import_excel(jsonb)               from anon, public;
revoke execute on function public.undo_import(uuid)                 from anon, public;
revoke execute on function public.import_trash_missing(uuid, text[]) from anon, public;
revoke execute on function public.import_finish(uuid)               from anon, public;
revoke execute on function public.find_profile_by_name(text)        from anon, public;
grant  execute on function public.import_excel(jsonb)               to authenticated;
grant  execute on function public.undo_import(uuid)                 to authenticated;
grant  execute on function public.import_trash_missing(uuid, text[]) to authenticated;
grant  execute on function public.import_finish(uuid)               to authenticated;
grant  execute on function public.find_profile_by_name(text)        to authenticated;

-- ---------------------------------------------------------------------
-- 6. TOPLU İŞLEM (owner/admin): seçilen görevlere sorumlu, öncelik, durum, termin, hatırlatma
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
    priority    = case when p_patch ? 'priority'    then p_patch->>'priority' else priority end,
    status      = case when p_patch ? 'status'      then p_patch->>'status' else status end,
    due_date    = case when p_patch ? 'due_date'    then nullif(p_patch->>'due_date', '')::date else due_date end,
    reminder    = case when p_patch ? 'reminder'    then p_patch->>'reminder' else reminder end,
    directorate = case when p_patch ? 'directorate' then nullif(p_patch->>'directorate', '') else directorate end
  where id = any(p_ids) and deleted_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.bulk_update_tasks(uuid[], jsonb) from public, anon;
grant  execute on function public.bulk_update_tasks(uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 7. ŞABLONLARI YENİDEN OLUŞTUR (owner/admin; Excel içe aktarma önizlemesinden)
-- ---------------------------------------------------------------------
create or replace function public.replace_templates(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok' using errcode = '42501'; end if;
  delete from public.task_templates where project_type in ('web','panel','is_plani');
  for r in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    insert into public.task_templates (project_type, sort_order, directorate, section, category, title, description,
                                       estimate_minutes, quantity, recurrence, freq_count, recurrence_day,
                                       reminder, priority, tags)
    values (r->>'project_type', (r->>'sort_order')::int, nullif(r->>'directorate', ''), r->>'section',
            nullif(r->>'category', ''), r->>'title', nullif(r->>'description', ''), (r->>'estimate_minutes')::int,
            coalesce((r->>'quantity')::int, 1), coalesce(nullif(r->>'recurrence', ''), 'once'),
            (r->>'freq_count')::int, nullif(r->>'recurrence_day', ''), coalesce(nullif(r->>'reminder', ''), 'none'),
            coalesce(nullif(r->>'priority', ''), 'medium'),
            array(select jsonb_array_elements_text(coalesce(r->'tags', '[]'))));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.replace_templates(jsonb) from public, anon;
grant  execute on function public.replace_templates(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 8. YENİ PROJE (kod öneki ve yeni alanlarla; 007'deki sürümün yerine geçer)
-- ---------------------------------------------------------------------
create or replace function public.create_project(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_project uuid; v_task uuid; v_no int; r jsonb; it jsonb; i int; n int := 0;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_type text := p->>'type';
  v_pre  text := upper(nullif(btrim(coalesce(p->>'code_prefix', '')), ''));
  ids uuid[] := '{}';
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'Proje adı boş olamaz' using errcode = '22023'; end if;
  if v_type not in ('web','panel','is_plani','program','birim') then raise exception 'Geçersiz proje türü' using errcode = '22023'; end if;
  if v_pre is not null and v_pre !~ '^[A-ZÇĞİÖŞÜ]{2,4}$' then
    raise exception 'Kod öneki 2–4 büyük harf olmalı' using errcode = '22023';
  end if;
  if exists (select 1 from public.projects where lower(name) = lower(v_name)) then
    raise exception 'Bu adla bir proje zaten var' using errcode = '23505';
  end if;
  if v_pre is not null and exists (select 1 from public.projects where upper(code_prefix) = v_pre) then
    raise exception 'Bu kod öneki başka bir projede kullanılıyor' using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(424242);
  insert into public.projects (name, type, sort_order, code_prefix)
  values (v_name, v_type, coalesce((select max(sort_order) from public.projects), 0) + 1, v_pre)
  returning id into v_project;

  select coalesce(max(no), 0) into v_no from public.tasks;
  perform set_config('app.importing', 'on', true);

  for r in select * from jsonb_array_elements(coalesce(p->'tasks', '[]')) loop
    v_no := v_no + 1;
    insert into public.lookups (kind, value, sort_order)
    select 'section', r->>'section', coalesce((select max(sort_order) from public.lookups where kind = 'section'), 0) + 1
    where nullif(r->>'section', '') is not null
      and not exists (select 1 from public.lookups where kind = 'section' and lower(value) = lower(r->>'section'));

    insert into public.tasks (no, code, project_id, directorate, section, category, title, description, tags, status, priority,
                              assignee_id, start_date, due_date, estimate_minutes, quantity, recurrence, freq_count,
                              recurrence_day, reminder)
    values (v_no, coalesce(public.next_task_code(v_project), '#' || v_no), v_project, nullif(r->>'directorate', ''), coalesce(nullif(r->>'section', ''), 'Genel'),
            nullif(r->>'category', ''), r->>'title',
            nullif(r->>'description', ''), array(select jsonb_array_elements_text(coalesce(r->'tags', '[]'))),
            'todo', coalesce(nullif(r->>'priority', ''), 'medium'),
            nullif(r->>'assignee_id', '')::uuid, nullif(r->>'start_date', '')::date, nullif(r->>'due_date', '')::date,
            nullif(r->>'estimate_minutes', '')::int, coalesce(nullif(r->>'quantity', '')::int, 1),
            coalesce(nullif(r->>'recurrence', ''), 'once'), nullif(r->>'freq_count', '')::int,
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

  update public.tasks set updated_at = now() where id = any(ids);
  perform set_config('app.importing', '', true);

  insert into public.activity_log (entity, entity_id, action, changes, profile_id)
  values ('projects', v_project, 'insert', jsonb_build_object('name', v_name, 'tasks', n), public.my_profile_id());

  return jsonb_build_object('project_id', v_project, 'tasks', n);
end $$;
revoke execute on function public.create_project(jsonb) from public, anon;
grant  execute on function public.create_project(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 9. LİSTE ADINI DEĞİŞTİR (direktörlük eklendi; 008'deki sürümün yerine geçer)
-- ---------------------------------------------------------------------
create or replace function public.rename_lookup(p_kind text, p_old text, p_new text) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; v_new text := btrim(coalesce(p_new, ''));
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok' using errcode = '42501'; end if;
  if p_kind not in ('directorate','section','category') or v_new = '' then raise exception 'Geçersiz değer' using errcode = '22023'; end if;
  if lower(v_new) <> lower(p_old) and exists (select 1 from public.lookups where kind = p_kind and lower(value) = lower(v_new)) then
    raise exception 'Bu ad listede zaten var' using errcode = '23505';
  end if;
  update public.lookups set value = v_new where kind = p_kind and value = p_old;
  if p_kind = 'directorate' then
    update public.tasks set directorate = v_new where directorate = p_old;
    get diagnostics n = row_count;
    update public.task_templates set directorate = v_new where directorate = p_old;
    update public.lookups set parent = v_new where kind = 'section' and parent = p_old;
  elsif p_kind = 'section' then
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

-- Proje kod önekini değiştir (owner/admin) – mevcut görev kodları değişmez
create or replace function public.set_project_prefix(p_project uuid, p_prefix text) returns void
language plpgsql security definer set search_path = public as $$
declare v_pre text := upper(nullif(btrim(coalesce(p_prefix, '')), ''));
begin
  if not public.is_admin() then raise exception 'Yetkiniz yok' using errcode = '42501'; end if;
  if v_pre is not null and v_pre !~ '^[A-ZÇĞİÖŞÜ]{2,4}$' then
    raise exception 'Kod öneki 2–4 büyük harf olmalı' using errcode = '22023';
  end if;
  if v_pre is not null and exists (select 1 from public.projects where upper(code_prefix) = v_pre and id <> p_project) then
    raise exception 'Bu kod öneki başka bir projede kullanılıyor' using errcode = '23505';
  end if;
  update public.projects set code_prefix = v_pre where id = p_project;
end $$;
revoke execute on function public.set_project_prefix(uuid, text) from public, anon;
grant  execute on function public.set_project_prefix(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Mevcut projelere kod öneki (ERA dosyasındaki önekler; boş olanlara)
-- ---------------------------------------------------------------------
update public.projects p set code_prefix = v.pre
from (values
  ('Evodak İş Takip Planlama & Görev Panel Projesi','GTP'), ('Evodak Property Management Web Projesi','PMW'),
  ('Evodak Sağlık Turizim Web Projesi','SGT'), ('Evodak Shaqqa Mafroosha Ankara Web Projesi','SMA'),
  ('Evodak Rental Apartments Web Projesi','RNT'), ('Evodak Bodrum Emlak Web Projesi','BDR'),
  ('Evodak Yatırım Danışmanlık Web Projesi','YTD'), ('Evodak Olala Web Projesi','OLA'),
  ('Evodak Bungalov Mersin İş Plan Projesi','BNG'), ('Evodak Ankara Bina İş Plan İş Plan Projesi','ANB'),
  ('Evodak Kızıbağ Villa İş Plan Projesi','KZB'), ('Evodak Viranşehir Villa İş Plan Projesi','VRN'),
  ('Evodak Mersin Güzelyayla İş Plan Projesi','GZY'), ('Evodak Avocado İş Plan Projesi','AVK'),
  ('Evodak Altınvadi Kentsel İş Plan İş Plan Projesi','ALT'), ('Evodak Ai Prompt Asistan Panel Projesi','APA'),
  ('Evodak Pazarlama Panel Projesi','PZP'), ('Evodak CRM Sistem Panel Projesi','CRM'),
  ('Evodak İstiridye Mantarı İş Plan Projesi','IST'), ('Evodak Bonsay İş Plan Projesi','BNS'),
  ('Evodak Miras Anı İş Plan Projesi','MRS')
) as v(name, pre)
where p.name = v.name and p.code_prefix is null
  and not exists (select 1 from public.projects q where upper(q.code_prefix) = v.pre);

notify pgrst, 'reload schema';
