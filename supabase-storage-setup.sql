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
