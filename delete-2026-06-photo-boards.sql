-- Supabase SQL editor에서 한 번만 실행하세요.
-- 2026년 6월 사진대지와 연결된 일차별 사진 기록을 삭제합니다.
delete from public.photo_boards
where pour_date >= date '2026-06-01'
  and pour_date < date '2026-07-01';
