-- =====================================================================
-- Evodak Görev Takip Paneli – 005_dosyalar.sql  (4. aşama)
-- Görevlere eklenen dosyalar için ÖZEL depo ve erişim kuralları.
-- Dosya yolu: <görev id>/<rastgele>-<dosya adı>
-- Görevi görebilen okur; görevi düzenleyebilen yükler ve siler.
-- =====================================================================

-- 1. Özel depo (herkese kapalı), dosya başına en fazla 20 MB
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

-- 2. Yoldan görev kimliğini güvenle çıkar (bozuk yolda NULL döner, erişim verilmez)
create or replace function public.path_task_id(p text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(p, '/', 1)::uuid;
exception when others then
  return null;
end $$;

-- 3. Erişim kuralları
drop policy if exists evodak_files_read   on storage.objects;
drop policy if exists evodak_files_insert on storage.objects;
drop policy if exists evodak_files_delete on storage.objects;

create policy evodak_files_read on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.can_see_task(public.path_task_id(name)));

create policy evodak_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.can_edit_task(public.path_task_id(name)));

create policy evodak_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and public.can_edit_task(public.path_task_id(name)));

-- 4. Toplam kullanılan alan (Ayarlar'daki gösterge için)
create or replace function public.storage_usage() returns jsonb
language sql stable security definer set search_path = public, storage as $$
  select jsonb_build_object(
    'bytes', coalesce(sum((o.metadata->>'size')::bigint), 0),
    'files', count(*))
  from storage.objects o
  where public.is_team()
$$;
revoke execute on function public.storage_usage() from public, anon;
grant  execute on function public.storage_usage() to authenticated;

-- 5. Ek kaydını yükleyen kişi otomatik yazılsın
create or replace function public.tg_attachment_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.uploaded_by := coalesce(new.uploaded_by, public.my_profile_id());
  return new;
end $$;
drop trigger if exists attachments_before on public.attachments;
create trigger attachments_before before insert on public.attachments
  for each row execute function public.tg_attachment_before();

-- Kontrol: depo ve 3 kural görünmeli
select id, public, file_size_limit from storage.buckets where id = 'files';
select policyname from pg_policies where tablename = 'objects' and policyname like 'evodak_files_%' order by 1;
