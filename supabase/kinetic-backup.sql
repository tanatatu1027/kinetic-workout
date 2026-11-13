-- KINETIC クラウドバックアップ用（Supabase の SQL Editor に貼って Run）
-- テーブルへの直接アクセスは全面禁止。合言葉(のハッシュ)を知っている人だけが、下の2つの関数で読み書きできる。
--
-- ■ 今回の変更点（既に本番で動いている想定の更新版。何度実行しても安全）
--   (a) p_key は「小文字16進64桁(SHA-256)」でなければ拒否  ( ^[0-9a-f]{64}$ )
--   (b) 1件のサイズ上限を 4.5MB -> 2MB に下げた（乱用時のDB肥大を防ぐ）
--   (c) 保存先(key_hash)の種類が全体で30を超える場合、新しい key での保存を拒否（既存 key の更新は可）
--   (d) 関数は search_path を空にし、テーブルは public.kinetic_backups とスキーマ付きで参照
--   (e) 日付は current_date ではなく日本時間 (now() at time zone 'Asia/Tokyo')::date で数える
--   (f) create table if not exists / create or replace function / 権限の再設定を含む（再実行しても壊れない）
--   (g) 関数の引数と返り値の形は変更なし（kinetic_save(p_key text, p_data jsonb) returns void、
--       kinetic_load(p_key text) returns table(day date, updated_at timestamptz, data jsonb)）。
--       そのため、このSQLを流す前でも後でも、現行のアプリはそのまま動く。
--
-- ■ 実行手順
--   1. Supabase ダッシュボード > 対象プロジェクト(kinetic-workout) > 左メニュー「SQL Editor」を開く
--   2. 「New query」を押し、このファイルの内容をすべて貼り付ける
--   3. 右下の「Run」を押す（"Success. No rows returned" と出れば完了）
--   4. 確認: Table Editor で kinetic_backups に RLS が有効(Enabled)であること。
--      アプリの設定画面で「今すぐバックアップ」を押し、エラーが出ないこと
--   5. 万一サイズ超過(2MB)で保存できなくなった場合は、下の 2000000 を大きくして再実行する
--   ※ 30種類の上限を変えたい場合は、下の kinetic_save 内の「30」を書き換えて再実行する

create table if not exists public.kinetic_backups (
  key_hash   text        not null check (char_length(key_hash) = 64),
  day        date        not null default (now() at time zone 'Asia/Tokyo')::date,
  updated_at timestamptz not null default now(),
  data       jsonb       not null,
  primary key (key_hash, day)
);

-- 既存テーブルの既定値も日本時間に揃える（再実行しても安全）
alter table public.kinetic_backups
  alter column day set default (now() at time zone 'Asia/Tokyo')::date;

alter table public.kinetic_backups enable row level security; -- ポリシーなし = 直接アクセス不可
revoke all on public.kinetic_backups from anon, authenticated;

-- 保存: 1日1行(その日の最新で上書き)、直近7日分を残す。空データでの上書きは拒否。
create or replace function public.kinetic_save(p_key text, p_data jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then raise exception 'bad key'; end if;
  if p_data is null or pg_column_size(p_data) > 2000000 then raise exception 'too large'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'bad data'; end if;
  if coalesce(jsonb_array_length(p_data->'workouts'), 0) = 0
     and coalesce(jsonb_array_length(p_data->'bodyLogs'), 0) = 0 then
    raise exception 'empty data';
  end if;

  -- 新しい key のときだけ、全体の種類数を確認する（既存 key の更新は常に可）
  if not exists (select 1 from public.kinetic_backups b where b.key_hash = p_key) then
    if (select count(distinct b.key_hash) from public.kinetic_backups b) >= 30 then
      raise exception 'too many keys';
    end if;
  end if;

  insert into public.kinetic_backups (key_hash, day, updated_at, data)
  values (p_key, v_today, now(), p_data)
  on conflict (key_hash, day) do update set updated_at = now(), data = excluded.data;

  delete from public.kinetic_backups
  where key_hash = p_key and day < v_today - 6;
end $$;

-- 取得: 新しい順に最大7件
create or replace function public.kinetic_load(p_key text)
returns table (day date, updated_at timestamptz, data jsonb)
language sql security definer set search_path = '' as $$
  select b.day, b.updated_at, b.data
  from public.kinetic_backups b
  where b.key_hash = p_key
  order by b.day desc
  limit 7;
$$;

revoke all on function public.kinetic_save(text, jsonb) from public;
revoke all on function public.kinetic_load(text) from public;
grant execute on function public.kinetic_save(text, jsonb) to anon;
grant execute on function public.kinetic_load(text) to anon;
