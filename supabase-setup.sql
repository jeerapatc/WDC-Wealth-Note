-- Wealth Note: ตารางรายชื่อผู้ลงทะเบียน (รันใน Supabase > SQL Editor)
create table if not exists public.leads (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  mode text not null check (mode in ('student','worker')),
  name text not null check (char_length(name) between 1 and 100),
  age int not null check (age between 5 and 100),
  phone text check (phone is null or phone ~ '^0[0-9]{8,9}$'),
  school text check (school is null or char_length(school) <= 150),
  consent boolean not null check (consent = true),
  consent_version text not null check (char_length(consent_version) <= 40)
);

alter table public.leads enable row level security;

-- ผู้ใช้แอป (anon) เพิ่มข้อมูลได้อย่างเดียว อ่าน/แก้/ลบไม่ได้
drop policy if exists "anon can insert leads" on public.leads;
create policy "anon can insert leads" on public.leads
  for insert to anon with check (consent = true);
-- ไม่มี policy select/update/delete = ดูข้อมูลได้เฉพาะใน Supabase dashboard (เจ้าของโปรเจกต์)
