-- =====================================================================
-- Evodak Görev Takip Paneli – 006_planlama.sql  (5. aşama)
-- 1) Tekrarlayan görev tamamlanınca: o tekrar geçmişe yazılır, tarih ileri alınır,
--    kontrol listesi sıfırlanır, oran 0, durum Yapılacak.
-- 2) Günlük özet: her kişiye kendi saatinde (gecikenler dahil).
-- 3) Bildirimdeki "Tamamlandı" tekrarlayan görevde iki kez ilerlemesin.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Görev tetikleyicisi (tekrar döngüsü eklendi)
-- ---------------------------------------------------------------------
create or replace function public.tg_tasks_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  total int; finished int;
  base date; nxt date; today date := (now() at time zone 'Europe/Istanbul')::date;
  prev_flag text;
  snap jsonb;
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

  -- TEKRAR DÖNGÜSÜ: tekrarlayan görev "Tamamlandı" olunca sıradaki tekrara geç
  if tg_op = 'UPDATE' and new.recurrence <> 'once' and new.status = 'done' and old.status <> 'done'
     and new.deleted_at is null and coalesce(current_setting('app.importing', true), '') <> 'on' then
    base := coalesce(old.due_date, new.due_date, today);
    nxt := public.next_occurrence(base, new.recurrence, new.recurrence_day, false);
    -- Gecikmiş bir tekrar tamamlandıysa geçmiş tarihli yeni tekrar üretme
    if nxt is not null and nxt < today then
      nxt := public.next_occurrence(today, new.recurrence, new.recurrence_day, true);
    end if;
    if nxt is not null then
      select coalesce(jsonb_agg(jsonb_build_object('text', text, 'note', note, 'done', done) order by sort_order), '[]')
        into snap from public.checklist_items where task_id = new.id;
      insert into public.task_occurrences (task_id, occurrence_date, completed_by, checklist_snapshot)
      values (new.id, base, public.my_profile_id(), snap);

      -- Maddeleri sıfırla (bu sırada madde tetikleyicileri ve satır satır geçmiş kaydı çalışmasın)
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
    end if;
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

-- Tekrar geçmişi panelden okunabilsin (görevi gören okur)
drop policy if exists occ_select on public.task_occurrences;
create policy occ_select on public.task_occurrences for select to authenticated using (public.can_see_task(task_id));

-- ---------------------------------------------------------------------
-- 2. Bildirim düğmesi: tekrarlayan görevde maddelere dokunmadan tamamla
--    (tetikleyici sıfırlar; böylece tarih yalnızca bir kez ilerler)
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
    if tsk.recurrence = 'once' then
      update public.checklist_items set done = true where task_id = tsk.id and not done;
    end if;
    update public.tasks set status = 'done' where id = tsk.id and status <> 'done';
  else
    insert into public.notification_snoozes (task_id, profile_id, until)
    values (tsk.id, tk.profile_id, now() + interval '10 minutes');
  end if;
  return jsonb_build_object('ok', true, 'action', p_action, 'title', tsk.title,
                            'recurring', tsk.recurrence <> 'once');
end $$;
revoke execute on function public.use_action_token(text, text) from public, anon, authenticated;
grant  execute on function public.use_action_token(text, text) to service_role;

-- ---------------------------------------------------------------------
-- 3. Planlama: hatırlatmalar + ertelemeler + GÜNLÜK ÖZET
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

  -- c) Günlük özet: kişinin kendi saatinde, günde bir kez (gecikenler özetin içinde)
  with s as (
    select p.id,
           (((now() at time zone 'Europe/Istanbul')::date + p.daily_summary_time) at time zone 'Europe/Istanbul') as fire_at
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
  return n;
end $$;
revoke execute on function public.plan_notifications() from public, anon, authenticated;
grant  execute on function public.plan_notifications() to service_role;

-- Kontrol
select 'tekrar döngüsü kuruldu' as durum;
