create extension if not exists "pgcrypto";

create table if not exists public.photo_boards (
  id uuid primary key default gen_random_uuid(),
  share_code text not null unique,
  project_name text not null default '세종천안 2공구 (주)서화',
  pour_part text not null default '',
  pour_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.photo_entries (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.photo_boards(id) on delete cascade,
  day_no integer not null check (day_no between 1 and 5),
  photo_url text,
  photo_path text,
  uploaded_by text,
  uploaded_at timestamptz,
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, day_no)
);

alter table public.photo_boards enable row level security;
alter table public.photo_entries enable row level security;

drop policy if exists "photo_boards_public_read" on public.photo_boards;
drop policy if exists "photo_boards_public_insert" on public.photo_boards;
drop policy if exists "photo_boards_public_update" on public.photo_boards;
drop policy if exists "photo_entries_public_read" on public.photo_entries;
drop policy if exists "photo_entries_public_insert" on public.photo_entries;
drop policy if exists "photo_entries_public_update" on public.photo_entries;

create policy "photo_boards_public_read"
on public.photo_boards for select
to anon
using (true);

create policy "photo_boards_public_insert"
on public.photo_boards for insert
to anon
with check (true);

create policy "photo_boards_public_update"
on public.photo_boards for update
to anon
using (true)
with check (true);

create policy "photo_entries_public_read"
on public.photo_entries for select
to anon
using (true);

create policy "photo_entries_public_insert"
on public.photo_entries for insert
to anon
with check (true);

create policy "photo_entries_public_update"
on public.photo_entries for update
to anon
using (true)
with check (true);

insert into storage.buckets (id, name, public)
values ('curing-photos', 'curing-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "curing_photos_public_read" on storage.objects;
drop policy if exists "curing_photos_public_insert" on storage.objects;
drop policy if exists "curing_photos_public_update" on storage.objects;
drop policy if exists "curing_photos_public_delete" on storage.objects;

create policy "curing_photos_public_read"
on storage.objects for select
to anon
using (bucket_id = 'curing-photos');

create policy "curing_photos_public_insert"
on storage.objects for insert
to anon
with check (bucket_id = 'curing-photos');

create policy "curing_photos_public_update"
on storage.objects for update
to anon
using (bucket_id = 'curing-photos')
with check (bucket_id = 'curing-photos');

create policy "curing_photos_public_delete"
on storage.objects for delete
to anon
using (bucket_id = 'curing-photos');

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'photo_boards'
  ) then
    alter publication supabase_realtime add table public.photo_boards;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'photo_entries'
  ) then
    alter publication supabase_realtime add table public.photo_entries;
  end if;
end $$;
