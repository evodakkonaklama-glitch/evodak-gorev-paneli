-- =====================================================================
-- Evodak Görev Takip Paneli – 009_google_plan.sql  (Paket 8)
-- 1) Zaman bloklama: görevleri günün saatlerine yerleştirme (task_time_blocks)
-- 2) Google Tasks bağlantısı: bağlantı durumu, gizli anahtarlar, eşleme tablosu
-- 3) Google'da tamamlanan görevi panelde tamamla (gtasks_complete)
-- 4) Zamanlayıcı: her 15 dakikada Google Tasks eşitlemesi
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Zaman blokları
-- ---------------------------------------------------------------------
create table if not exists public.task_time_blocks (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint time_block_range check (end_at > start_at and end_at - start_at <= interval '12 hours')
);
create index if not exists time_blocks_profile_idx on public.task_time_blocks (profile_id, start_at);
create index if not exists time_blocks_task_idx on public.task_time_blocks (task_id);
alter table public.task_time_blocks enable row level security;
grant select, insert, update, delete on public.task_time_blocks to authenticated;
grant all on public.task_time_blocks to service_role;

drop policy if exists blocks_select on public.task_time_blocks;
drop policy if exists blocks_write  on public.task_time_blocks;
create policy blocks_select on public.task_time_blocks for select to authenticated
  using ((profile_id = public.my_profile_id() or public.is_admin()) and public.can_see_task(task_id));
create policy blocks_write on public.task_time_blocks for all to authenticated
  using (profile_id = public.my_profile_id() or public.is_admin())
  with check (public.can_see_task(task_id) and public.my_role() in ('owner','admin','member')
              and (profile_id = public.my_profile_id() or public.is_admin()));

do $$ begin
  alter publication supabase_realtime add table public.task_time_blocks;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. Google Tasks
-- ---------------------------------------------------------------------
-- Kişinin görebildiği bağlantı durumu (gizli anahtar burada DEĞİL)
create table if not exists public.google_connections (
  profile_id    uuid primary key references public.profiles(id) on delete cascade,
  google_email  text,
  tasklist_id   text,
  last_sync_at  timestamptz,
  last_error    text,
  synced_count  int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.google_connections enable row level security;
grant select on public.google_connections to authenticated;
grant all on public.google_connections to service_role;
drop policy if exists gconn_select on public.google_connections;
create policy gconn_select on public.google_connections for select to authenticated
  using (profile_id = public.my_profile_id());

-- Yenileme anahtarı: yalnızca sunucu (service_role) okur/yazar. Kullanıcıya hiçbir politika yok.
create table if not exists public.google_tokens (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  refresh_token  text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.google_tokens enable row level security;
revoke all on public.google_tokens from anon, authenticated;
grant all on public.google_tokens to service_role;

-- Panel görevi <-> Google görevi eşlemesi (yalnızca sunucu)
create table if not exists public.google_task_links (
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  task_id         uuid not null,
  google_task_id  text not null,
  synced_version  int,
  synced_at       timestamptz not null default now(),
  primary key (profile_id, task_id)
);
alter table public.google_task_links enable row level security;
revoke all on public.google_task_links from anon, authenticated;
grant all on public.google_task_links to service_role;

-- ---------------------------------------------------------------------
-- 3. Google'da "tamamlandı" işaretlenen görevi panelde tamamla
--    (geçmişte kişinin adıyla görünür; tekrarlayan görev sıradaki tekrara geçer)
-- ---------------------------------------------------------------------
create or replace function public.gtasks_complete(p_task uuid, p_profile uuid) returns text
language plpgsql security definer set search_path = public as $$
declare tsk public.tasks%rowtype;
begin
  select * into tsk from public.tasks where id = p_task;
  if not found or tsk.deleted_at is not null or tsk.status in ('done','cancelled') then return 'skip'; end if;
  perform set_config('app.actor', p_profile::text, true);
  if tsk.recurrence = 'once' then
    update public.checklist_items set done = true where task_id = tsk.id and not done;
  end if;
  update public.tasks set status = 'done' where id = tsk.id and status <> 'done';
  return case when tsk.recurrence = 'once' then 'done' else 'recurring' end;
end $$;
revoke execute on function public.gtasks_complete(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.gtasks_complete(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4. Zamanlayıcı: her 15 dakikada eşitleme
-- ---------------------------------------------------------------------
select cron.unschedule(jobname) from cron.job where jobname = 'google-tasks-sync';
select cron.schedule('google-tasks-sync', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://znmeghdcyrarfpkuxtvp.supabase.co/functions/v1/google-tasks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_eRXjy8MMFBk_k_AL1H4koQ_jHdJX9NU',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"mode":"cron"}'::jsonb,
    timeout_milliseconds := 120000)
$job$);

-- Kontrol: dört zamanlanmış iş görünmeli
select jobname, schedule from cron.job order by jobname;
