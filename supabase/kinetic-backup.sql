-- KINETIC クラウドバックアップ用（Supabase の SQL Editor に貼って Run）
-- テーブルへの直接アクセスは全面禁止。合言葉(のハッシュ)を知っている人だけが、下の2つの関数で読み書きできる。

create table if not exists public.kinetic_backups (
  key_hash   text        not null check (char_length(key_hash) = 64),
  day        date        not null default current_date,
  updated_at timestamptz not null default now(),
  data       jsonb       not null,
  primary key (key_hash, day)
);

alter table public.kinetic_backups enable row level security; -- ポリシーなし = 直接アクセス不可
revoke all on public.kinetic_backups from anon, authenticated;

-- 保存: 1日1行(その日の最新で上書き)、直近7日分を残す。空データでの上書きは拒否。
create or replace function public.kinetic_save(p_key text, p_data jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or char_length(p_key) <> 64 then raise exception 'bad key'; end if;
  if pg_column_size(p_data) > 4500000 then raise exception 'too large'; end if;
  if coalesce(jsonb_array_length(p_data->'workouts'), 0) = 0
     and coalesce(jsonb_array_length(p_data->'bodyLogs'), 0) = 0 then
    raise exception 'empty data';
  end if;

  insert into kinetic_backups (key_hash, day, updated_at, data)
  values (p_key, current_date, now(), p_data)
  on conflict (key_hash, day) do update set updated_at = now(), data = excluded.data;

  delete from kinetic_backups
  where key_hash = p_key and day < current_date - 6;
end $$;

-- 取得: 新しい順に最大7件
create or replace function public.kinetic_load(p_key text)
returns table (day date, updated_at timestamptz, data jsonb)
language sql security definer set search_path = public as $$
  select b.day, b.updated_at, b.data
  from kinetic_backups b
  where b.key_hash = p_key
  order by b.day desc
  limit 7;
$$;

revoke all on function public.kinetic_save(text, jsonb) from public;
revoke all on function public.kinetic_load(text) from public;
grant execute on function public.kinetic_save(text, jsonb) to anon;
grant execute on function public.kinetic_load(text) to anon;
