# Cogno Reader 云端接入手册（Supabase + Stripe）

> 本文件的模块来自《cogno-Reader优化建议一版本.md》Phase 1（1.1-1.4）、2.2（云端报告）、4.2、5.x。
> 这些模块**需要外部账号与密钥**，我（Claude）无法代注册。以下按其依赖顺序说明每一层的实现方式与所需配置。
> 本地/纯前端部分（Phase 2.1 测评、3.1 信号融合、3.2 测试、3.3 PWA、3.4 移动端、4.1 图谱脚本）无需本文件。

## 0. 总原则

- **本地优先**：所有写操作先落 IndexedDB（即时响应），后台队列推 Supabase（last-write-wins 按 ts）
- **未配置即禁用**：`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` 为空时，应用保持纯本地模式，一行云代码都不运行
- 敏感设置（AI API Key 等）**不同步云端**

## 1. 注册 Supabase（约 15 分钟）

1. 打开 https://supabase.com → Sign in（可用 GitHub 账号）
2. Create new project：给一个区域（选 Singapore 或 Tokyo 靠近国内）、数据库密码
3. 记下 Project URL（`https://xxxx.supabase.co`）与 anon key（Settings → API）

## 2. 建表（SQL Editor 粘贴执行）

```sql
-- 数据表与 RLS：用户只能读写自己的数据
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free','pro','enterprise')),
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);
create table public.reading_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text, source_type text, started_at timestamptz,
  ended_at timestamptz, duration_sec int, concepts_touched text[],
  agent_interventions int default 0, doc_id bigint,
  last_page int, last_scroll_position int,
  created_at timestamptz not null default now()
);
create table public.review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  concept_id text not null, mastery int default 0,
  review_count int default 0, last_reviewed_at timestamptz,
  next_review_at timestamptz, history jsonb
);
create table public.cognitive_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  session_id uuid, understanding int, attention int,
  fatigue int, divergence int, flow boolean, ts timestamptz
);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  stripe_subscription_id text, status text, plan text,
  current_period_start timestamptz, current_period_end timestamptz
);
create table public.llm_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text unique not null, answer text,
  created_at timestamptz default now(), expires_at timestamptz
);

-- RLS：所有表只允许本人
alter table public.profiles enable row level security;
alter table public.reading_sessions enable row level security;
alter table public.review_items enable row level security;
alter table public.cognitive_logs enable row level security;
alter table public.subscriptions enable row level security;
alter table public.llm_cache enable row level security;

create policy "own profiles" on public.profiles for all using (auth.uid() = id);
create policy "own sessions" on public.reading_sessions for all using (auth.uid() = user_id);
create policy "own reviews"  on public.review_items  for all using (auth.uid() = user_id);
create policy "own logs"    on public.cognitive_logs for all using (auth.uid() = user_id);
create policy "own subs"    on public.subscriptions for all using (auth.uid() = user_id);
create policy "own cache"   on public.llm_cache       for all using (auth.uid() = user_id);

create index if not exists idx_sessions_user on public.reading_sessions (user_id, started_at desc);
create index if not exists idx_reviews_user on public.review_items (user_id, next_review_at);
create index if not exists idx_logs_session on public.cognitive_logs (session_id, ts);
```

## 3. 前端接入（拿到项目后按序实现）

1. 安装 `@supabase/supabase-js`，创建 `src/lib/supabase.ts`（createClient + 类型导出）
2. `src/lib/auth.ts`：邮箱注册/登录/登出/Google OAuth/会话监听
3. `src/lib/sync.ts`：SyncEngine（pushQueue 存 localStorage `cogno.syncQueue`，上限 500；flush 重试；pullUserData 全量拉取；last-write-wins）
4. modify `src/lib/storage.ts`：每次写库后 enqueue 同步；`src/lib/behavioralSignals.ts` 认知日志只同步 7 天聚合
5. `src/components/Auth/AuthPage.tsx`：登录注册 UI（品牌色 #6c5ce7，移动端全屏）

## 4. Stripe（付费）

1. 注册 https://stripe.com（需要企业/个人信息验证）
2. 创建两个 Price（¥29/月 Pro、¥99/人/年 Enterprise）
3. Edge Function `stripe-checkout`：创建 Checkout Session 返回 `{url}`
4. Edge Function `stripe-webhook`：处理 `checkout.session.completed` 等事件，写 subscriptions 表
5. 前端 `PricingPanel`：调 Edge Function + `billing.ts` 权限判定
6. 权限模型：free = 每日 AI 介入 3 次/1 学科图谱；pro = 无限/云端同步/间隔回顾；enterprise = pro + 管理后台/SSO/API

## 5. 环境变量与 Secrets

| 变量 | 位置 | 说明 |
|---|---|---|
| `VITE_SUPABASE_URL` `VITE_SUPABASE_ANON_KEY` | GitHub Secrets → actions 注入构建 | 前端必需 |
| `COGNO_DEPLOY_KEY_B64` | GitHub Secrets（**当前 CI 已使用**） | 部署私钥 base64，见 `.github/deploy-key.pub` |
| `STRIPE_SECRET_KEY` 等 | Supabase Edge Function Secrets | 服务端专用 |

## 6. CI/CD（已就绪）

`.github/workflows/deploy.yml`：push main → npm test + build → scp → 服务器 nginx 解压 → 健康检查。
**首次启用**：仓库 Settings → Secrets and variables → Actions → 新建 `COGNO_DEPLOY_KEY_B64`（值 = 部署私钥的 base64 编码；生成方式见 README 部署章节）。

## 7. 安全注意事项

- 云同步上线后，设置页 DataControls 的"删除我的数据"同时清理本地与云端
- 摄像头画面永不上传；认知推断全部本地完成
- RLS 策略是云端数据安全底线——任何新表都要补 policy