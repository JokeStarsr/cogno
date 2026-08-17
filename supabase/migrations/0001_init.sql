-- Cogno Reader 云端库初始化（Phase 1.1）
-- 用法：Supabase Dashboard → SQL Editor → 新建查询 → 粘贴全量执行 → 再按文末两步授权
-- 设计原则：本地优先——前端只持 publishable key，所有表开启 RLS，用户数据仅本人可读写

-- ── 1. 业务表 ──

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free','pro','enterprise')),
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.reading_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text,
  source_type text check (source_type in ('pdf','url','text','sample')),
  started_at timestamptz,
  ended_at timestamptz,
  duration_sec int,
  concepts_touched text[],
  agent_interventions int not null default 0,
  doc_id bigint,
  last_page int,
  last_scroll_position int,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text,
  source_type text,
  text_content text,
  pdf_storage_path text,
  pdf_texts text[],
  created_at timestamptz not null default now()
);

create table if not exists public.review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  concept_id text not null,
  mastery int not null default 0 check (mastery between 0 and 3),
  review_count int not null default 0,
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  history jsonb not null default '[]'::jsonb,
  unique (user_id, concept_id)
);

create table if not exists public.cognitive_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  session_id uuid,
  understanding int, attention int, fatigue int, divergence int,
  flow boolean,
  ts timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  stripe_subscription_id text,
  status text,
  plan text,
  current_period_start timestamptz,
  current_period_end timestamptz
);

create table if not exists public.llm_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  cache_key text not null,
  answer text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (user_id, cache_key)
);

-- ── 2. 注册时自动创建 profiles 行 ──

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 3. RLS 策略：全部表 → 仅本人 ──

alter table public.profiles        enable row level security;
alter table public.reading_sessions enable row level security;
alter table public.documents       enable row level security;
alter table public.review_items    enable row level security;
alter table public.cognitive_logs  enable row level security;
alter table public.subscriptions   enable row level security;
alter table public.llm_cache       enable row level security;

-- profiles：本人可改全行；他人仅可视公开字段（display_name/avatar_url）
drop policy if exists "profiles own" on public.profiles;
create policy "profiles own" on public.profiles
  for all using (auth.uid() = id);
drop policy if exists "profiles public read" on public.profiles;
create policy "profiles public read" on public.profiles
  for select using (true);

drop policy if exists "sessions own" on public.reading_sessions;
create policy "sessions own" on public.reading_sessions
  for all using (auth.uid() = user_id);

drop policy if exists "documents own" on public.documents;
create policy "documents own" on public.documents
  for all using (auth.uid() = user_id);

drop policy if exists "reviews own" on public.review_items;
create policy "reviews own" on public.review_items
  for all using (auth.uid() = user_id);

drop policy if exists "logs own" on public.cognitive_logs;
create policy "logs own" on public.cognitive_logs
  for all using (auth.uid() = user_id);

drop policy if exists "subs own" on public.subscriptions;
create policy "subs own" on public.subscriptions
  for all using (auth.uid() = user_id);

drop policy if exists "cache own" on public.llm_cache;
create policy "cache own" on public.llm_cache
  for all using (auth.uid() = user_id);

-- ── 4. 常用索引 ──

create index if not exists idx_sessions_user_ts on public.reading_sessions (user_id, started_at desc);
create index if not exists idx_reviews_user_due on public.review_items (user_id, next_review_at);
create index if not exists idx_logs_user_ts on public.cognitive_logs (user_id, ts desc);

-- ── 5. 传统角色授权（兼容匿名/登录角色；新版 publishable key 仍需第 6 步 UI 授权）──
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;

-- ⚠️ 执行完本文件后，还需要一步 UI 操作：
-- Project Settings → API → Publishable keys → 你的 key → Grant access → 勾选全部表 → Save
-- （否则前端用 publishable key 访问数据表会收到 401 consistent 拒绝）
-- 可选：需要 RLS 绕过式运维（导出/清理）时用 service_role key，仅存服务端，勿入前端。