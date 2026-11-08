-- =====================================================================
-- Evodak Görev Takip Paneli – 003_seed.sql
-- İlk kişiler. 002_import.sql'den SONRA çalıştırın.
-- Hesapları Authentication > Users ekranında aynı e-postalarla açınca
-- profil kendiliğinden hesaba bağlanır (sıra önemli değil).
-- =====================================================================

insert into public.profiles
  (full_name, email, role, language, daily_summary_time, quiet_hours_start, quiet_hours_end,
   only_own_tasks, email_notifications)
values
  ('Hakan', 'hkgunsur@gmail.com',         'owner', 'tr', '08:30', '22:00', '08:00', false, false),
  ('Gamze', 'evodak.konaklama@gmail.com', 'admin', 'tr', '08:30', '22:00', '08:00', false, true)
on conflict (email) do nothing;

-- Kontrol: iki satır görmelisiniz; "hesap_bagli" hesap açıldıysa true olur
select full_name, email, role, user_id is not null as hesap_bagli from public.profiles order by role desc;
