-- =====================================================================
-- Evodak Görev Takip Paneli – 001_schema.sql
-- Supabase > SQL Editor > New query > bu dosyanın tamamını yapıştır > Run
-- Tekrar çalıştırılabilir değildir; boş bir projede bir kez çalıştırılır.
-- Saat dilimi: Europe/Istanbul. Kodlar İngilizce, ekranda TR/EN etiket gösterilir.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. ORTAK ALAN DEĞERLERİ (Excel'deki Türkçe değerler içe aktarmada bu kodlara çevrilir)
-- ---------------------------------------------------------------------
-- status   : todo | in_progress | waiting | blocked | done | cancelled
-- priority : urgent | high | medium | low
-- recurrence: once | daily | weekdays | weekly | monthly | yearly
-- reminder : none | at_time | 15m | 1h | 1d | 1w
-- role     : owner | admin | member | viewer
-- project type: web | panel | is_plani

-- ---------------------------------------------------------------------
-- 2. TABLOLAR
-- ---------------------------------------------------------------------

create table public.profiles (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid unique references auth.users(id) on delete set null,
  full_name            text not null,
  email                text unique,
  role                 text not null default 'member' check (role in ('owner','admin','member','viewer')),
  phone                text,
  language             text not null default 'tr' check (language in ('tr','en')),
  theme                text not null default 'system' check (theme in ('light','dark','system')),
  daily_summary_time   time default '08:30',
  quiet_hours_start    time,
  quiet_hours_end      time,
  only_own_tasks       boolean not null default false,
  email_notifications  boolean not null default false,
  active               boolean not null default true,
  last_seen_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid
);
create unique index profiles_full_name_uq on public.profiles (lower(full_name));

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  type        text not null check (type in ('web','panel','is_plani')),
  sort_order  int  not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid
);

create table public.lookups (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('section','category','tag')),
  value       text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  unique (kind, value)
);

create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  no                int  not null unique,
  project_id        uuid not null references public.projects(id),
  section           text not null,
  category          text,
  title             text not null,
  description       text,
  tags              text[] not null default '{}',
  status            text not null default 'todo'
                      check (status in ('todo','in_progress','waiting','blocked','done','cancelled')),
  priority          text not null default 'medium' check (priority in ('urgent','high','medium','low')),
  progress          int  not null default 0 check (progress between 0 and 100),
  assignee_id       uuid references public.profiles(id) on delete set null,
  start_date        date,
  due_date          date,
  due_time          time not null default '09:00',
  estimate_minutes  int check (estimate_minutes is null or estimate_minutes >= 0),
  recurrence        text not null default 'once'
                      check (recurrence in ('once','daily','weekdays','weekly','monthly','yearly')),
  recurrence_day    text,          -- haftalıkta 'mon'..'sun', aylıkta '1'..'31'
  reminder          text not null default 'none' check (reminder in ('none','at_time','15m','1h','1d','1w')),
  reference_links   text[] not null default '{}',
  next_reminder_at  timestamptz,   -- tetikleyici hesaplar; sunucu bu alana bakar
  completed_at      timestamptz,
  version           int  not null default 1,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid
);
create index tasks_project_idx   on public.tasks (project_id) where deleted_at is null;
create index tasks_assignee_idx  on public.tasks (assignee_id) where deleted_at is null;
create index tasks_due_idx       on public.tasks (due_date) where deleted_at is null;
create index tasks_reminder_idx  on public.tasks (next_reminder_at) where next_reminder_at is not null;

create table public.checklist_items (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  text        text not null,
  note        text,                -- Excel'de " – " sonrasındaki açıklama
  done        boolean not null default false,
  done_at     timestamptz,
  done_by     uuid references public.profiles(id) on delete set null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid
);
create index checklist_task_idx on public.checklist_items (task_id, sort_order);

-- Tekrarlayan görevin tamamlanmış geçmiş tekrarları (görev satırı aynı kalır, NO değişmez)
create table public.task_occurrences (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references public.tasks(id) on delete cascade,
  occurrence_date     date not null,
  completed_at        timestamptz not null default now(),
  completed_by        uuid references public.profiles(id) on delete set null,
  checklist_snapshot  jsonb not null default '[]',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid
);
create index occurrences_task_idx on public.task_occurrences (task_id, occurrence_date desc);

create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks(id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint not null check (size_bytes <= 20971520),   -- 20 MB
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid
);
create index attachments_task_idx on public.attachments (task_id);

create table public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references public.profiles(id) on delete cascade,
  endpoint         text not null unique,
  p256dh           text not null,
  auth             text not null,
  device_name      text,
  user_agent       text,
  last_success_at  timestamptz,
  failure_count    int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid
);

-- Gönderim kaydı: aynı bildirim iki kez gitmesin
create table public.notification_log (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references public.tasks(id) on delete cascade,   -- günlük özette boş
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('reminder','daily_summary','overdue','test')),
  fire_at     timestamptz not null,
  channel     text not null check (channel in ('push','email')),
  status      text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts    int  not null default 0,
  last_error  text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  constraint notification_log_once unique nulls not distinct (task_id, profile_id, kind, fire_at, channel)
);
create index notification_log_retry_idx on public.notification_log (status, attempts) where status = 'failed';

-- Uygulama içi bildirim merkezi (zil simgesi)
create table public.inbox (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  task_id     uuid references public.tasks(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid
);
create index inbox_profile_idx on public.inbox (profile_id, created_at desc);

create table public.notification_snoozes (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  until       timestamptz not null,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid
);
create index snoozes_due_idx on public.notification_snoozes (until) where sent_at is null;

-- Bildirim düğmeleri için tek kullanımlık token (yalnızca özeti saklanır)
create table public.notification_action_tokens (
  token_hash  text primary key,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table public.task_templates (
  id                uuid primary key default gen_random_uuid(),
  project_type      text not null check (project_type in ('web','panel','is_plani')),
  sort_order        int  not null default 0,
  section           text not null,
  category          text,
  title             text not null,
  description       text,
  estimate_minutes  int,
  recurrence        text not null default 'once',
  recurrence_day    text,
  reminder          text not null default 'none',
  priority          text not null default 'medium',
  tags              text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid
);

create table public.activity_log (
  id          bigint generated always as identity primary key,
  entity      text not null,
  entity_id   uuid not null,
  task_id     uuid,              -- görev geçmişinde listelemek için
  action      text not null check (action in ('insert','update','delete','restore','import','complete_occurrence')),
  changes     jsonb not null default '{}',   -- {"alan": {"old": .., "new": ..}}
  profile_id  uuid,
  created_at  timestamptz not null default now()
);
create index activity_task_idx on public.activity_log (task_id, created_at desc);

-- Excel içe aktarmayı geri almak için
create table public.import_batches (
  id                 uuid primary key default gen_random_uuid(),
  file_name          text,
  summary            jsonb not null default '{}',
  inserted_task_ids  uuid[] not null default '{}',
  before_snapshot    jsonb not null default '[]',   -- güncellenen görevlerin eski hali
  undone_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid
);

create table public.backups (
  id          uuid primary key default gen_random_uuid(),
  json_path   text not null,
  xlsx_path   text,
  size_bytes  bigint,
  kind        text not null default 'weekly' check (kind in ('weekly','manual')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid
);

-- Tek satırlık ayar tablosu
create table public.app_settings (
  id                     int primary key default 1 check (id = 1),
  daily_work_minutes     int  not null default 240,
  default_due_time       time not null default '09:00',
  timezone               text not null default 'Europe/Istanbul',
  last_activity_at       timestamptz not null default now(),   -- "uzun süredir kullanılmadı" uyarısı
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid,
  updated_by             uuid
);
insert into public.app_settings (id) values (1);

-- ---------------------------------------------------------------------
-- 3. YETKİ YARDIMCILARI (RLS içinde kullanılır)
-- ---------------------------------------------------------------------
create or replace function public.my_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where user_id = auth.uid() and active
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid() and active
$$;

create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and active)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner','admin'), false)
$$;

create or replace function public.can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner','admin','member'), false)
$$;

create or replace function public.my_only_own() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select only_own_tasks from public.profiles where user_id = auth.uid()), true)
$$;

create or replace function public.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and public.is_team()
      and (public.is_admin() or not public.my_only_own() or t.assignee_id = public.my_profile_id())
      and (t.deleted_at is null or public.is_admin())
  )
$$;

create or replace function public.can_edit_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (public.is_admin()
           or (public.my_role() = 'member' and t.assignee_id = public.my_profile_id()))
  )
$$;

-- ---------------------------------------------------------------------
-- 4. HESAPLAMA FONKSİYONLARI
-- ---------------------------------------------------------------------

-- Hatırlatma anı: (bitiş tarihi + saat, İstanbul) – hatırlatma süresi
create or replace function public.compute_remind_at(p_date date, p_time time, p_reminder text)
returns timestamptz language sql stable as $$
  select case
    when p_date is null or p_reminder = 'none' then null
    else ((p_date + coalesce(p_time, '09:00'::time)) at time zone 'Europe/Istanbul')
         - case p_reminder
             when 'at_time' then interval '0'
             when '15m'     then interval '15 minutes'
             when '1h'      then interval '1 hour'
             when '1d'      then interval '1 day'
             when '1w'      then interval '7 days'
           end
  end
$$;

-- Tekrar kuralına göre p_from tarihinden SONRAKİ (p_inclusive ise o gün dahil) ilk tarih
create or replace function public.next_occurrence(p_from date, p_rule text, p_day text, p_inclusive boolean default false)
returns date language plpgsql immutable as $$
declare
  d date := case when p_inclusive then p_from else p_from + 1 end;
  dow_target int;
  dom int;
  m date;
  last_day int;
begin
  if p_from is null or p_rule = 'once' then return null; end if;

  if p_rule = 'daily' then
    return d;
  elsif p_rule = 'weekdays' then
    while extract(isodow from d) > 5 loop d := d + 1; end loop;
    return d;
  elsif p_rule = 'weekly' then
    dow_target := case lower(coalesce(p_day, ''))
      when 'mon' then 1 when 'tue' then 2 when 'wed' then 3 when 'thu' then 4
      when 'fri' then 5 when 'sat' then 6 when 'sun' then 7
      else extract(isodow from p_from)::int end;
    while extract(isodow from d)::int <> dow_target loop d := d + 1; end loop;
    return d;
  elsif p_rule = 'monthly' then
    dom := coalesce(nullif(p_day, '')::int, extract(day from p_from)::int);
    m := date_trunc('month', d)::date;
    loop
      last_day := extract(day from (m + interval '1 month - 1 day'))::int;
      if (m + (least(dom, last_day) - 1)) >= d then
        return m + (least(dom, last_day) - 1);
      end if;
      m := (m + interval '1 month')::date;
    end loop;
  elsif p_rule = 'yearly' then
    m := p_from;
    while m < d loop m := (m + interval '1 year')::date; end loop;
    return m;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 5. TETİKLEYİCİLER
-- ---------------------------------------------------------------------

-- Ortak: updated_at / created_by / updated_by
create or replace function public.tg_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_profile_id();
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, me);
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(me, new.updated_by);
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','projects','lookups','tasks','checklist_items','task_occurrences',
                           'attachments','push_subscriptions','notification_log','inbox',
                           'notification_snoozes','task_templates','import_batches','backups','app_settings']
  loop
    execute format('create trigger %I_stamp before insert or update on public.%I
                    for each row execute function public.tg_stamp()', t, t);
  end loop;
end $$;

-- Görev: sürüm, ilerleme, tamamlanma, hatırlatma zamanı, üye kısıtı
create or replace function public.tg_tasks_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare total int; finished int;
begin
  -- Üye görevi başkasına atayamaz / projesini değiştiremez
  if tg_op = 'UPDATE' and public.my_role() = 'member'
     and (new.assignee_id is distinct from old.assignee_id or new.project_id is distinct from old.project_id
          or new.no is distinct from old.no) then
    raise exception 'Bu alanı değiştirme yetkiniz yok' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then new.version := old.version + 1; end if;

  -- Tekrarlayan görevde bitiş tarihi yoksa başlangıçtan itibaren ilk tekrar
  if new.recurrence <> 'once' and new.due_date is null and new.start_date is not null then
    new.due_date := public.next_occurrence(new.start_date, new.recurrence, new.recurrence_day, true);
  end if;

  -- İlerleme yalnızca maddelerden hesaplanır (elle girilen değer yok sayılır)
  select count(*), count(*) filter (where done) into total, finished
  from public.checklist_items where task_id = new.id;
  if total > 0 then
    new.progress := round(finished * 100.0 / total);
  else
    new.progress := case when new.status = 'done' then 100 else 0 end;
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

create trigger tasks_before before insert or update on public.tasks
  for each row execute function public.tg_tasks_before();

-- Kontrol listesi değişince: görevin durumu ve oranı
create or replace function public.tg_checklist_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tid uuid := coalesce(new.task_id, old.task_id);
  total int; finished int; cur text; nxt text;
begin
  -- Excel içe aktarma sırasında atlanır; içe aktarma sonunda toplu hesaplanır
  if current_setting('app.importing', true) = 'on' then return null; end if;
  select count(*), count(*) filter (where done) into total, finished
  from public.checklist_items where task_id = tid;
  select status into cur from public.tasks where id = tid;
  if cur is null then return null; end if;

  nxt := cur;
  if total > 0 then
    if finished = total then nxt := 'done';
    elsif finished > 0 and cur in ('todo','done') then nxt := 'in_progress';
    elsif finished < total and cur = 'done' then nxt := 'in_progress';
    end if;
  end if;
  -- güncelleme her durumda yapılır: oran tg_tasks_before içinde yeniden hesaplanır
  update public.tasks set status = nxt where id = tid;
  return null;
end $$;

create trigger checklist_after after insert or update of done, task_id or delete on public.checklist_items
  for each row execute function public.tg_checklist_after();

-- Madde tiklenince kim/ne zaman
create or replace function public.tg_checklist_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_at := coalesce(new.done_at, now());
    new.done_by := coalesce(new.done_by, public.my_profile_id());
  elsif not new.done then
    new.done_at := null; new.done_by := null;
  end if;
  return new;
end $$;

create trigger checklist_before before insert or update on public.checklist_items
  for each row execute function public.tg_checklist_before();

-- Değişiklik geçmişi
create or replace function public.tg_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else '{}' end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else '{}' end;
  diff jsonb := '{}';
  k text;
  act text := lower(tg_op);
  tid uuid;
begin
  -- Excel içe aktarmada satır satır değil, tek "import" kaydı yazılır
  if current_setting('app.importing', true) = 'on' then return null; end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at','updated_by','version','next_reminder_at','created_at','created_by')
         and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('old', o -> k, 'new', n -> k));
      end if;
    end loop;
    if diff = '{}' then return null; end if;
    if tg_table_name = 'tasks' and (o ->> 'deleted_at') is null and (n ->> 'deleted_at') is not null then act := 'delete'; end if;
    if tg_table_name = 'tasks' and (o ->> 'deleted_at') is not null and (n ->> 'deleted_at') is null then act := 'restore'; end if;
  elsif tg_op = 'INSERT' then
    diff := n - 'created_at' - 'updated_at' - 'created_by' - 'updated_by';
  else
    diff := o;
  end if;

  tid := case when tg_table_name = 'tasks' then coalesce((n->>'id')::uuid, (o->>'id')::uuid)
              else coalesce((n->>'task_id')::uuid, (o->>'task_id')::uuid) end;

  insert into public.activity_log (entity, entity_id, task_id, action, changes, profile_id)
  values (tg_table_name, coalesce((n->>'id')::uuid, (o->>'id')::uuid), tid, act, diff, public.my_profile_id());
  return null;
end $$;

create trigger tasks_activity      after insert or update or delete on public.tasks           for each row execute function public.tg_activity();
create trigger checklist_activity  after insert or update or delete on public.checklist_items for each row execute function public.tg_activity();
create trigger attachments_activity after insert or delete on public.attachments              for each row execute function public.tg_activity();

-- Yeni hesap açılınca e-postası eşleşen profile bağla (davetle eklenen kişiler)
create or replace function public.tg_link_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set user_id = new.id
  where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.tg_link_profile();

-- Profil, hesap açıldıktan SONRA eklenirse de eşleşsin
create or replace function public.tg_profile_link_user() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.user_id is null and new.email is not null then
    select id into new.user_id from auth.users where lower(email) = lower(new.email) limit 1;
  end if;
  return new;
end $$;

create trigger profiles_link_user before insert or update of email on public.profiles
  for each row execute function public.tg_profile_link_user();

-- ---------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles                   enable row level security;
alter table public.projects                   enable row level security;
alter table public.lookups                    enable row level security;
alter table public.tasks                      enable row level security;
alter table public.checklist_items            enable row level security;
alter table public.task_occurrences           enable row level security;
alter table public.attachments                enable row level security;
alter table public.push_subscriptions         enable row level security;
alter table public.notification_log           enable row level security;
alter table public.inbox                      enable row level security;
alter table public.notification_snoozes       enable row level security;
alter table public.notification_action_tokens enable row level security;  -- politika yok: yalnızca sunucu
alter table public.task_templates             enable row level security;
alter table public.activity_log               enable row level security;
alter table public.import_batches             enable row level security;
alter table public.backups                    enable row level security;
alter table public.app_settings               enable row level security;

-- profiles: ekip birbirini görür; kişi kendi tercihlerini, owner/admin herkesi düzenler
create policy profiles_select on public.profiles for select to authenticated using (public.is_team());
create policy profiles_insert on public.profiles for insert to authenticated with check (public.is_admin() and role <> 'owner' or public.my_role() = 'owner');
create policy profiles_update_self on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and role = public.my_role());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.my_role() = 'owner' or (public.is_admin() and role <> 'owner'))
  with check (public.my_role() = 'owner' or (public.is_admin() and role <> 'owner'));
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.my_role() = 'owner' and role <> 'owner');

-- projects / lookups / templates / settings: herkes okur, owner/admin yazar
create policy projects_select  on public.projects for select to authenticated using (public.is_team());
create policy projects_write   on public.projects for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy lookups_select   on public.lookups  for select to authenticated using (public.is_team());
create policy lookups_write    on public.lookups  for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy templates_select on public.task_templates for select to authenticated using (public.is_team());
create policy templates_write  on public.task_templates for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy settings_select  on public.app_settings for select to authenticated using (public.is_team());
create policy settings_update  on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- tasks
create policy tasks_select on public.tasks for select to authenticated
  using (public.is_team()
         and (public.is_admin() or not public.my_only_own() or assignee_id = public.my_profile_id())
         and (deleted_at is null or public.is_admin()));
create policy tasks_insert on public.tasks for insert to authenticated with check (public.is_admin());
create policy tasks_update on public.tasks for update to authenticated
  using (public.is_admin() or (public.my_role() = 'member' and assignee_id = public.my_profile_id()))
  with check (public.is_admin() or (public.my_role() = 'member' and assignee_id = public.my_profile_id()));
create policy tasks_delete on public.tasks for delete to authenticated using (public.my_role() = 'owner');

-- görevin alt kayıtları: görevi gören okur, düzenleyebilen yazar
create policy checklist_select on public.checklist_items for select to authenticated using (public.can_see_task(task_id));
create policy checklist_write  on public.checklist_items for all to authenticated
  using (public.can_edit_task(task_id)) with check (public.can_edit_task(task_id));
create policy occ_select on public.task_occurrences for select to authenticated using (public.can_see_task(task_id));
create policy occ_write  on public.task_occurrences for all to authenticated
  using (public.can_edit_task(task_id)) with check (public.can_edit_task(task_id));
create policy att_select on public.attachments for select to authenticated using (public.can_see_task(task_id));
create policy att_insert on public.attachments for insert to authenticated with check (public.can_edit_task(task_id));
create policy att_delete on public.attachments for delete to authenticated using (public.can_edit_task(task_id));
create policy activity_select on public.activity_log for select to authenticated
  using (public.is_admin() or (task_id is not null and public.can_see_task(task_id)));

-- kişisel bildirim kayıtları: yalnızca sahibi
create policy push_own on public.push_subscriptions for all to authenticated
  using (profile_id = public.my_profile_id()) with check (profile_id = public.my_profile_id());
create policy inbox_select on public.inbox for select to authenticated using (profile_id = public.my_profile_id());
create policy inbox_update on public.inbox for update to authenticated
  using (profile_id = public.my_profile_id()) with check (profile_id = public.my_profile_id());
create policy snooze_own on public.notification_snoozes for all to authenticated
  using (profile_id = public.my_profile_id()) with check (profile_id = public.my_profile_id());
create policy notif_log_select on public.notification_log for select to authenticated
  using (profile_id = public.my_profile_id() or public.is_admin());

-- içe aktarma ve yedek: owner/admin
create policy imports_all on public.import_batches for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy backups_select on public.backups for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- 7. REALTIME (diğer kişinin değişikliği birkaç saniyede gelsin)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table
  public.tasks, public.checklist_items, public.attachments, public.projects,
  public.lookups, public.inbox, public.profiles;

-- ---------------------------------------------------------------------
-- 8. OTURUM İŞARETİ: panel her açılışta çağırır (kullanılmama uyarısı için)
-- ---------------------------------------------------------------------
create or replace function public.touch_activity() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now() where user_id = auth.uid();
  update public.app_settings set last_activity_at = now() where id = 1;
$$;
revoke execute on function public.touch_activity() from anon;

-- Not: pg_cron + pg_net zamanlamaları (her dakika send-reminders, haftalık yedek,
-- 30 günlük çöp temizliği) 2. ve 6. aşamadaki ayrı migration dosyalarında gelir.
