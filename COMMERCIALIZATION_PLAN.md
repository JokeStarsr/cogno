# Cogno Reader 商业化实施方案 & AI 提示词手册

> 本文档面向阿里云百炼 TokenPlan / 通义灵码等 AI 编程助手，按模块拆解任务，每个步骤附可直接使用的提示词。
> 人工工作量估算约 8 周，AI 辅助预计 2-3 周完成全部实施。

---

## 数据库现状与升级方案

### 当前

**Dexie.js（浏览器 IndexedDB）**，5 张表：`settings`、`concepts`、`sessions`、`cognitiveLogs`、`docs`。

纯浏览器本地存储，数据零上传。适合 PoC，但无法支撑商业化。

### 升级方案

**保留 IndexedDB 作为本地缓存 + 新增 Supabase PostgreSQL 作为服务端主库。**

| 层 | 技术 | 职责 |
|----|------|------|
| 本地缓存 | Dexie / IndexedDB（现有） | 离线可用、即时响应、隐私兜底 |
| 服务端主库 | Supabase PostgreSQL | 多端同步、付费状态、数据分析 |
| 实时同步 | Supabase Realtime (WebSocket) | 本地写入后自动推送到云端 |
| 文件存储 | Supabase Storage | PDF 文档存储 |

**数据流**：用户操作 → 先写 IndexedDB（即时返回）→ 后台队列推 Supabase → Realtime 广播到其他设备。

升级步骤与提示词见下方 Phase 1。

---

## Phase 1：基础商业化（后端账号 + 支付 + 合规 + CI/CD）

### 模块 1.1：Supabase 项目初始化与数据库设计

**任务**：创建 Supabase 项目，定义核心数据表，启用 RLS 行级安全。

**提示词**：

```
我正在将一个名为 Cogno Reader 的 React + TypeScript 项目从纯前端（IndexedDB）
升级为支持多端同步的 SaaS 产品。后端选型为 Supabase。

请帮我完成以下工作：

1. 生成 Supabase 数据库迁移 SQL（放在 supabase/migrations/ 目录），包含以下表：

   - users（由 Supabase Auth 自动管理，不需要手动创建）
   - profiles: id(uuid, 外键到 auth.users), display_name, avatar_url, plan('free'|'pro'|'enterprise'), created_at
   - reading_sessions: id(uuid), user_id(外键), title, source_type('pdf'|'url'|'text'|'sample'), started_at, ended_at, duration_sec, concepts_touched(text[]), agent_interventions, doc_id, last_page, last_scroll_position
   - documents: id(uuid), user_id(外键), title, source_type, text_content, pdf_storage_path, pdf_texts(text[]), created_at
   - review_items: id(uuid), user_id(外键), concept_id, mastery(0-3), review_count, last_reviewed_at, next_review_at, history(jsonb)
   - cognitive_logs: id(uuid), user_id(外键), session_id(外键), understanding, attention, fatigue, divergence, flow, ts
   - subscriptions: id(uuid), user_id(外键), stripe_subscription_id, status, plan, current_period_start, current_period_end
   - llm_cache: id(uuid), cache_key(text, 唯一), answer, created_at, expires_at

2. 为每张表创建 RLS 策略：用户只能读写自己的数据。
   profiles 表允许用户读取他人的 display_name 和 avatar_url（公开信息）。

3. 创建索引：reading_sessions(user_id, started_at)、review_items(user_id, next_review_at)、cognitive_logs(session_id, ts)。

4. 把已有的 Dexie 数据库 schema（src/lib/storage.ts）作为参考，保持字段命名风格一致。

5. 生成 src/lib/supabase.ts 客户端初始化文件，包含：
   - createClient() 初始化
   - 环境变量SUPABASE_URL 和 SUPABASE_ANON_KEY 的读取
   - 类型导出（从数据库 schema 自动推导的 TypeScript 类型）
```

### 模块 1.2：数据同步层（本地 IndexedDB ↔ Supabase）

**任务**：实现"本地优先 + 后台同步"模式，读写先到 IndexedDB，后台队列推送到 Supabase。

**提示词**：

```
在 Cogno Reader 项目中，当前所有数据通过 Dexie.js 存储在浏览器 IndexedDB（src/lib/storage.ts）。
现在需要新增 Supabase 云端同步，实现"本地优先 + 后台同步"模式。

请帮我完成以下工作：

1. 创建 src/lib/sync.ts，实现 SyncEngine 类：
   - 构造函数接收 Supabase client 和 Dexie db 实例
   - pushQueue: 待同步队列（暂存到 localStorage 的 cogno.syncQueue）
   - enqueue(operation): 将操作 {table, action('insert'|'update'|'delete'), data, ts} 加入队列
   - flush(): 消费队列，逐个推送到 Supabase，失败的留在队列等待重试
   - pullUserData(): 登录后拉取全量数据（sessions, documents, review_items, cognitive_logs），写入本地 IndexedDB
   - 冲突策略：last-write-wins（按 ts 时间戳比较）
   - 网络不可用时静默跳过，不报错

2. 修改 src/lib/storage.ts：
   - 所有写入操作（saveDoc、appendCognitiveLog、review 等）在完成 IndexedDB 写入后，
     自动调用 sync.enqueue() 将操作加入同步队列
   - 新增 initSync() 函数：登录后调用 sync.pullUserData() 拉取云端数据

3. 创建 src/lib/auth.ts：
   - signUp(email, password): 注册
   - signIn(email, password): 登录
   - signInWithGoogle(): Google OAuth 登录
   - signOut(): 登出并清空本地敏感数据
   - getSession(): 获取当前会话
   - onAuthStateChange(callback): 监听登录状态变化

4. 注意：
   - 同步队列最大保留 500 条，超出则丢弃最旧的
   - 敏感数据（API Key 等 settings 表中的 key）不同步到云端
   - 认知日志只同步最近 7 天的聚合数据（每 30s 一条），不同步原始 2s 采样
```

### 模块 1.3：登录注册 UI

**任务**：新增登录/注册页面，集成 Supabase Auth UI。

**提示词**：

```
在 Cogno Reader 项目中新增登录注册功能。项目技术栈：React 18 + TypeScript + Vite + CSS Modules。

请帮我完成以下工作：

1. 创建 src/components/Auth/AuthPage.tsx 和 AuthPage.css：
   - 邮箱 + 密码注册表单
   - 邮箱 + 密码登录表单
   - "使用 Google 账号登录"按钮
   - 表单验证：邮箱格式、密码 ≥ 8 位
   - 错误提示：邮箱已注册、密码错误、网络错误等
   - 加载状态：按钮 disabled + spinner

2. 在 App.tsx 中集成：
   - 未登录时显示 AuthPage，登录后显示正常三页导航
   - 顶部导航右侧显示用户头像 + 下拉菜单（个人信息、登出）
   - 首次登录后自动调用 sync.pullUserData() 拉取云端数据

3. 状态管理：
   - 在 AppContext.tsx 中新增 user 状态（User | null）
   - 使用 supabase.auth.onAuthStateChange 监听登录状态变化

4. 样式要求：
   - 登录页居中卡片式布局，品牌色 #6c5ce7
   - 与现有设计系统 tokens.css 保持一致
   - 支持移动端（≤480px 全屏）
```

### 模块 1.4：付费系统（Stripe 集成）

**任务**：集成 Stripe 支付，实现免费/Pro/企业三级订阅。

**提示词**：

```
在 Cogno Reader 项目中集成 Stripe 订阅支付。后端使用 Supabase。

请帮我完成以下工作：

1. 创建 Supabase Edge Function: supabase/functions/stripe-checkout/index.ts
   - 接收 POST 请求，参数：priceId（Stripe 价格 ID）
   - 创建 Stripe Checkout Session，设置 success_url 和 cancel_url
   - 返回 { url: checkoutSession.url }
   - 鉴权：验证 Supabase Auth JWT

2. 创建 Supabase Edge Function: supabase/functions/stripe-webhook/index.ts
   - 接收 Stripe Webhook 事件
   - 处理 checkout.session.completed：创建/更新 subscriptions 表
   - 处理 customer.subscription.updated：更新订阅状态
   - 处理 customer.subscription.deleted：标记订阅过期
   - 验证 Stripe 签名

3. 创建 src/components/Settings/PricingPanel.tsx 和 PricingPanel.css：
   - 三栏定价卡片：免费 / Pro（¥29/月）/ 企业（¥99/人/年）
   - 每栏列出核心权益对比
   - Pro 和企业卡片有"立即订阅"按钮，点击调用 stripe-checkout Edge Function
   - 当前方案高亮显示
   - 已订阅 Pro 的用户显示"管理订阅"（跳转 Stripe Customer Portal）

4. 创建 src/lib/billing.ts：
   - getCurrentPlan(): 从 profiles 表读取 plan 字段
   - canUseFeature(feature): 根据 plan 检查功能权限
   - 权限定义：
     - free: 每日 AI 代理介入上限 3 次，1 个学科图谱
     - pro: 无限 AI 代理，全部学科，云端同步，间隔回顾
     - enterprise: pro 全部 + 管理后台 + SSO + API

5. 在 AgentPanel 中集成：
   - 免费用户每日 AI 代理介入计数，超出后弹出升级提示
   - 本地降级问答不计入额度
```

### 模块 1.5：隐私合规

**任务**：隐私政策、用户协议、数据处理合规。

**提示词**：

```
在 Cogno Reader 项目中添加隐私合规功能。项目核心功能包含浏览器摄像头眼动追踪。

请帮我完成以下工作：

1. 创建 src/components/Legal/PrivacyConsent.tsx：
   - 首次使用弹窗，必须用户同意才能进入应用
   - 内容：简述数据收集范围（眼动坐标、阅读行为、摄像头）、用途（仅本地认知推断）、存储位置（本地 + Supabase 云端）、不分享给第三方
   - 两个按钮：「查看完整隐私政策」和「同意并继续」
   - 同意状态存 localStorage（cogno.privacyConsent）

2. 创建 src/components/Settings/DataControls.tsx：
   - 「导出我的数据」按钮：打包所有本地 + 云端数据为 JSON 下载
   - 「删除我的数据」按钮：二次确认后清除本地 IndexedDB + 云端 Supabase 数据 + 登出
   - 确认弹窗用红色警告样式，需输入"删除"确认

3. 摄像头授权优化（修改 src/lib/eyeTracking.ts）：
   - 每次启用眼动前弹出明确说明："摄像头画面仅在浏览器本地处理，不会录制或上传"
   - 用户可随时关闭眼动并清除校准数据
   - 摄像头状态在 UI 上始终可见（状态环旁小图标）

4. 创建 public/privacy.html 和 public/terms.html：
   - 隐私政策页面（中文），包含：数据收集清单、使用目的、存储方式、用户权利、联系方式
   - 用户协议页面（中文），包含：服务说明、用户义务、免责声明、知识产权
```

### 模块 1.6：CI/CD 自动部署

**任务**：GitHub Actions 自动构建、测试、部署到 Vercel。

**提示词**：

```
在 Cogno Reader 项目中添加 CI/CD。项目是 Vite + React + TypeScript，托管在 GitHub。

请帮我完成以下工作：

1. 创建 .github/workflows/deploy.yml：
   - 触发条件：push 到 main 分支
   - 步骤：
     a. checkout 代码
     b. 设置 Node.js 20
     c. npm ci
     d. npm run build（tsc + vite build）
     e. 部署到 Vercel（使用 amondnet/vercel-action）
   - 环境变量通过 GitHub Secrets 注入：VERCEL_TOKEN、VERCEL_ORG_ID、VERCEL_PROJECT_ID、VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY

2. 创建 .github/workflows/preview.yml：
   - 触发条件：PR 到 main
   - 同样步骤，但部署到 Vercel 预览环境
   - 在 PR 评论区自动贴预览 URL

3. 创建 .github/workflows/test.yml：
   - 触发条件：push 到任意分支、PR
   - 运行 npm run test（后续添加测试后生效）
```

---

## Phase 2：效果验证（内置测评 + A/B 框架）

### 模块 2.1：测评引擎

**任务**：阅读前/后自动生成概念理解题，计算提升幅度。

**提示词**：

```
在 Cogno Reader 项目中新增内置测评功能。项目使用 Anthropic 兼容 API 调用 LLM。

请帮我完成以下工作：

1. 创建 src/lib/quiz.ts：
   - generateQuiz(conceptLabel: string, context: string, config: LLMConfig): Promise<QuizQuestion[]>
     调用 LLM 生成 3 道选择题（4 选项），每道题测试对概念的理解深度
     返回格式：{ question, options: string[], correctIndex: number, explanation }
   - 生成前测和后测两套题（不同具体题目，但测试同一概念）
   - 如果 LLM 不可用，回退到本地模板（根据概念描述生成简单问答）

2. 创建 src/components/Reader/QuizOverlay.tsx 和 QuizOverlay.css：
   - 阅读前弹出"前测"：3 道选择题，每题选完才能下一题
   - 阅读后弹出"后测"：3 道新题
   - 完成后显示对比结果：前测得分 → 后测得分，提升幅度（百分比）
   - 动画过渡：得分变化用数字滚动动画

3. 在 ReaderPage 中集成：
   - 新文档开始阅读时触发前测
   - 文档阅读完成（或用户点"完成阅读"）时触发后测
   - 测试结果存入 cognitive_logs 表（新增字段 pretest_score, posttest_score）

4. 创建 src/components/Dashboard/LearningOutcomes.tsx：
   - 展示最近 7/30 天的理解提升趋势图（折线图）
   - 按概念分组展示：每个概念的前测/后测平均分
   - 无图表库依赖，纯 CSS + SVG 实现简单折线图
```

### 模块 2.2：A/B 实验框架

**任务**：用户随机分桶，对比介入组 vs 对照组的学习效果。

**提示词**：

```
在 Cogno Reader 项目中新增 A/B 实验框架。

请帮我完成以下工作：

1. 创建 src/lib/experiment.ts：
   - assignBucket(userId: string): 'control' | 'treatment'
     基于 userId 的 hash 值随机分桶（50/50），同一用户始终在同一桶
   - isTreatmentGroup(userId: string): boolean
   - 实验配置存 localStorage（cogno.experiment），包含 bucket 和分配时间

2. 修改 AgentPanel 和 readingSignals：
   - 对照组（control）：四代理不自动介入，但用户仍可手动点击对话
   - 实验组（treatment）：四代理正常自动介入
   - 两组其他功能完全一致

3. 创建 src/components/Dashboard/ExperimentReport.tsx（仅管理员可见）：
   - 对照组 vs 实验组的关键指标对比：
     - 平均后测得分
     - 平均阅读时长
     - 7 日回访率
     - 概念掌握度提升均值
   - 显著性检验：展示 p 值（简单 t 检验）

4. 在 Supabase 中新增 experiments 表：
   - user_id, bucket, assigned_at, group
```

---

## Phase 3：体验加固（眼动融合 + 测试 + PWA + 移动端）

### 模块 3.1：多信号融合认知引擎

**任务**：将摄像头眼动、鼠标行为、纯行为信号融合，提升认知推断可靠性。

**提示词**：

```
在 Cogno Reader 项目中，当前认知引擎（src/lib/cognitive.ts）仅依赖眼动追踪数据。
需要升级为多信号融合引擎，确保无摄像头/手机/平板也能正常工作。

请帮我完成以下工作：

1. 创建 src/lib/behavioralSignals.ts：
   - 监听文本选中事件（selectionchange）：记录选中文本长度和频率
   - 监听复制事件（copy）：作为"深度阅读"信号
   - 监听页面可见性变化（visibilitychange）：切标签 = 走神
   - 监听窗口失焦/聚焦（blur/focus）
   - 导出 BehavioralSignalTracker 类，提供 getRecentSignals(windowMs) 方法

2. 重构 src/lib/cognitive.ts 的 CognitiveEngine：
   - 新增 signalWeights 配置：{ gaze: 0.5, mouse: 0.3, behavioral: 0.2 }
   - 新增 setAvailableSignals(signals: string[]) 方法，动态调整权重
   - 无摄像头时自动将 gaze 权重分配给 mouse 和 behavioral
   - 理解深度计算中加入：选中文本频率（正向）、复制频率（正向）、失焦频率（负向）
   - 注意力计算中加入：鼠标在阅读区停留占比

3. 保留向后兼容：
   - 现有 CognitiveEngine 的公开 API 不变
   - 新信号为可选增强，不破坏现有功能

4. 创建 src/lib/__tests__/cognitive.test.ts：
   - 测试 pureBehavioral 模式（无摄像头）下的理解深度检测
   - 测试多信号融合权重分配
   - 测试极端场景：所有信号不可用时的降级行为
```

### 模块 3.2：测试覆盖

**任务**：核心逻辑单元测试 + 关键组件集成测试。

**提示词**：

```
在 Cogno Reader 项目中添加测试。技术栈：vitest + @testing-library/react。

请帮我完成以下工作：

1. 安装测试依赖：
   - vitest, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, jsdom, happy-dom

2. 配置 vitest（vite.config.ts 中新增 test 配置）：
   - environment: 'jsdom'
   - setupFiles: './src/test-setup.ts'
   - globals: true

3. 创建以下测试文件：

   src/lib/__tests__/agents.test.ts：
   - 测试 AgentTrigger.evaluate() 各触发条件
   - 测试冷静期内不触发
   - 测试心流状态不触发
   - 测试冷却期后的重复触发限制

   src/lib/__tests__/knowledge.test.ts：
   - 测试 allPrerequisites() 传递闭包
   - 测试 findLearningPath() 最短路径
   - 测试 findGaps() 缺口检测
   - 测试 blockageScore() 阻塞度排序

   src/lib/__tests__/localAgent.test.ts：
   - 测试 2-gram 匹配：口语化输入命中正确概念
   - 测试无关输入不误命中
   - 测试每个代理的话术模板输出
   - 测试每代理 2 轮上限

   src/lib/__tests__/spacedRepetition.test.ts：
   - 测试 nextInterval() 间隔计算
   - 测试 review() 掌握度演进
   - 测试遗忘降级逻辑

   src/lib/__tests__/llm.test.ts：
   - 测试 classifyFailure() 各种失败场景
   - 测试 trimHistory() 预算裁剪
   - 测试 trimContext() 上下文裁剪

   src/components/__tests__/CognitiveStateRing.test.tsx：
   - 测试四层圆环渲染
   - 测试心流状态 visual indicator
   - 测试小屏模式下徽标渲染

4. 创建 src/test-setup.ts：
   - 导入 @testing-library/jest-dom
   - Mock webgazer 全局对象
   - Mock IndexedDB（使用 fake-indexeddb）
   - Mock fetch（用于 LLM 调用测试）

5. 在 package.json 中新增 scripts：
   - "test": "vitest run"
   - "test:watch": "vitest"
   - "test:coverage": "vitest run --coverage"
```

### 模块 3.3：PWA 离线支持

**任务**：添加 Service Worker，实现离线可用 + 安装到桌面。

**提示词**：

```
在 Cogno Reader 项目中添加 PWA 支持。项目使用 Vite 构建。

请帮我完成以下工作：

1. 安装 vite-plugin-pwa 并配置（vite.config.ts）：
   - registerType: 'autoUpdate'
   - 包含 manifest：name "Cogno Reader"，short_name "Cogno"，theme_color "#6c5ce7"
   - 图标：生成 192x192 和 512x512 的 SVG 图标
   - workbox: globPatterns 缓存所有静态资源，runtimeCaching 缓存 Supabase API 请求（stale-while-revalidate）

2. 创建 public/manifest.json：
   - 定义 PWA 清单：名称、图标、启动 URL、显示模式（standalone）、主题色、背景色

3. 离线提示：
   - 在 AppContext 中监听 online/offline 事件
   - 离线时顶部显示黄色横幅"当前处于离线模式，数据将在联网后自动同步"
   - 恢复在线时横幅消失，自动触发 sync.flush()

4. 确保离线功能：
   - 阅读器离线完全可用（读取本地 IndexedDB 中的文档）
   - 知识网格离线可用（图谱数据已打包在代码中）
   - 本地降级问答离线可用
   - AI 代理对话显示"离线模式，AI 不可用"提示
```

### 模块 3.4：移动端适配

**任务**：完善 480px 手机竖屏和 1024px 平板布局。

**提示词**：

```
在 Cogno Reader 项目中完善移动端适配。当前已有 720px 断点，需要扩展到 480px 和 1024px。

请帮我完成以下工作：

1. 在 src/styles/global.css 中新增媒体查询断点：

   @media (max-width: 480px):
   - 阅读器占满全屏，无左右留白
   - 状态环固定在底部（高度 64px），显示为紧凑横条（4 个指标并排）
   - 代理面板从底部滑入（sheet 样式），占屏幕 60% 高度
   - 顶部导航变为底部 Tab Bar（学习概览 / 阅读器 / 设置）
   - 字体缩小：正文 15px，标题 18px

   @media (min-width: 481px) and (max-width: 1024px):
   - 阅读器左右留白 24px
   - 状态环在右侧固定（宽度 120px）
   - 代理面板在右侧（宽度 280px）
   - 顶部导航保持水平

   @media (min-width: 1025px):
   - 当前桌面布局不变

2. 触摸优化：
   - 所有按钮最小点击区域 44x44px（Apple HIG 标准）
   - 添加触摸滚动惯性（-webkit-overflow-scrolling: touch）
   - 文本选中时不出系统菜单（user-select 优化）

3. 移动端特有交互：
   - 左右滑动手势切换页面（阅读器 ↔ 知识网格）
   - 下拉刷新同步数据
   - 长按概念高亮弹出操作菜单（加入复习 / 查看详情）
```

---

## Phase 4：生态扩展（图谱自动生成 + 多学科）

### 模块 4.1：LLM 图谱自动生成

**任务**：用 LLM 从学科大纲自动生成知识图谱。

**提示词**：

```
在 Cogno Reader 项目中新增知识图谱自动生成工具。

请帮我完成以下工作：

1. 创建 scripts/generate-graph.ts（独立脚本，不打包进前端）：
   - 接收命令行参数：--discipline "机器学习" --chapters "监督学习,无监督学习,深度学习,强化学习"
   - 调用 LLM API（Anthropic 兼容端点），Prompt 模板：
     """
     你是课程设计专家。请为"{discipline}"学科生成知识图谱。
     章节包括：{chapters}
     要求：
     - 提取 20-40 个核心概念，每个概念包含：id（英文 snake_case）、label（中文）、description（一句话描述）、dependencies（前置概念 id 列表）、difficulty（1=入门 2=进阶 3=高级）
     - 依赖关系必须形成有向无环图（DAG）
     - 输出纯 JSON 数组，不要 markdown 包裹
     """
   - 验证输出：检查 JSON 格式、循环依赖检测、重复 id 检测、孤立节点检测
   - 输出到 src/data/{discipline}.ts，格式与现有 dsAlgoGraph.ts 一致

2. 创建 src/data/graphRegistry.ts：
   - 统一管理所有学科图谱
   - 导出 GRAPH_REGISTRY: Record<string, { name, concepts, icon }>
   - 支持按需加载（dynamic import）

3. 修改 KnowledgeGrid 组件：
   - 设置页新增"学科"下拉选择器
   - 切换学科时动态加载对应图谱
   - 保留现有的 Cytoscape 懒加载逻辑

4. 用该脚本生成首批 3 个图谱：
   - 机器学习（machine-learning）
   - 操作系统（operating-system）
   - 计算机网络（computer-network）
```

### 模块 4.2：社区贡献系统

**任务**：用户可提交新概念，管理员审核后合并。

**提示词**：

```
在 Cogno Reader 项目中新增社区贡献功能。

请帮我完成以下工作：

1. 创建 src/components/KnowledgeGrid/ContributeConcept.tsx：
   - "提议新概念"按钮（在知识网格工具栏中）
   - 弹出表单：概念名称、描述、前置概念（多选，从现有图谱中选）、难度
   - 提交后写 Supabase 表 knowledge_contributions
   - 提交成功提示"已提交审核，感谢贡献！"

2. 创建 Supabase 表 knowledge_contributions：
   - id, user_id, discipline, concept_label, description, dependencies(text[]), difficulty, status('pending'|'approved'|'rejected'), reviewer_notes, created_at

3. 创建 src/components/Admin/ContributionReview.tsx（仅管理员可见）：
   - 待审核列表，每条显示：概念信息、提交者、提交时间
   - 「批准」按钮：将概念合并到对应学科图谱
   - 「拒绝」按钮：填写拒绝原因
   - 批准后自动更新图谱并通知提交者

4. 管理员权限：
   - 在 profiles 表新增 role 字段（'user'|'admin'）
   - 手动在 Supabase Dashboard 设置管理员
```

---

## Phase 5：B 端（管理后台 + 团队分析）

### 模块 5.1：企业/学校管理后台

**任务**：团队管理、学习分析、SSO 登录。

**提示词**：

```
在 Cogno Reader 项目中新增企业/学校管理后台。

请帮我完成以下工作：

1. 创建 src/components/Admin/AdminDashboard.tsx 和 AdminDashboard.css：
   - 仅 enterprise plan 用户可见
   - 概览卡片：团队人数、活跃用户数、平均学习时长、总概念掌握数
   - 团队学习热力图：横轴时间（最近 30 天），纵轴用户，颜色深浅 = 学习时长
   - 薄弱环节预警：列出团队掌握度最低的 10 个概念

2. 创建 src/components/Admin/TeamManagement.tsx：
   - 邀请成员：输入邮箱发送邀请链接（通过 Supabase Auth 的 inviteUserByEmail）
   - 成员列表：姓名、邮箱、最近活跃、学习时长、概念掌握数
   - 移除成员：二次确认

3. 创建 src/components/Admin/ContentAssignment.tsx：
   - 选择文档（管理员已上传或指定 URL）
   - 选择目标成员/团队
   - 设置截止日期
   - 成员端收到"新的阅读任务"通知
   - 追踪完成率：xx/yy 人已完成

4. 创建 Supabase 表：
   - teams: id, name, owner_id, created_at
   - team_members: team_id, user_id, role('admin'|'member'), joined_at
   - assignments: id, team_id, doc_id, assigned_by, due_date, created_at
   - assignment_completions: assignment_id, user_id, completed_at, quiz_score

5. SSO 集成（SAML/OIDC）：
   - 在 Supabase Auth 中配置企业 SSO（通过 Supabase Dashboard）
   - 登录页新增"企业 SSO 登录"入口
   - 输入企业域名后跳转对应 IdP 登录页
```

### 模块 5.2：分析报告导出

**任务**：生成团队学习分析报告，支持 PDF/CSV 导出。

**提示词**：

```
在 Cogno Reader 管理后台中新增分析报告导出功能。

请帮我完成以下工作：

1. 创建 src/lib/reportGenerator.ts：
   - generateTeamReport(teamId): 生成团队学习分析数据
     包含：团队总览、个人排名、概念掌握热力图、薄弱环节、学习趋势
   - exportToCSV(data): 将数据导出为 CSV 文件下载
   - exportToPDF(data): 使用浏览器 print 功能生成 PDF（利用 @media print CSS）

2. 创建 src/components/Admin/ReportView.tsx：
   - 时间范围选择器（最近 7 天 / 30 天 / 90 天 / 自定义）
   - 报告预览（在页面内渲染）
   - 「导出 CSV」和「导出 PDF」按钮
   - 定期报告：可设置每周/每月自动发送报告到管理员邮箱

3. 创建 src/styles/print.css：
   - @media print 下隐藏导航、按钮等 UI 元素
   - 仅保留报告内容
   - A4 纸张尺寸适配
```

---

## 附录 A：环境变量清单

```
# Supabase
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...

# Stripe（仅 Edge Function 使用，不暴露前端）
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_ENTERPRISE_PRICE_ID=price_...

# Vercel 部署
VERCEL_TOKEN=...
VERCEL_ORG_ID=...
VERCEL_PROJECT_ID=...
```

## 附录 B：npm 新增依赖

```json
{
  "@supabase/supabase-js": "^2.45.0",
  "stripe": "^16.0.0",
  "vite-plugin-pwa": "^0.20.0",
  "vitest": "^2.0.0",
  "@testing-library/react": "^16.0.0",
  "@testing-library/jest-dom": "^6.4.0",
  "@testing-library/user-event": "^14.5.0",
  "jsdom": "^24.0.0",
  "fake-indexeddb": "^6.0.0"
}
```

## 附录 C：实施优先级与依赖关系

```
Phase 1（基础）─ 无依赖，最先做
  ├── 1.1 Supabase 初始化
  ├── 1.2 数据同步层 ← 依赖 1.1
  ├── 1.3 登录 UI ← 依赖 1.1
  ├── 1.4 付费系统 ← 依赖 1.1
  ├── 1.5 隐私合规 ← 独立
  └── 1.6 CI/CD ← 独立

Phase 2（验证）─ 依赖 Phase 1 的 Supabase
  ├── 2.1 测评引擎 ← 依赖 1.2（需云端存储测评数据）
  └── 2.2 A/B 框架 ← 依赖 1.2

Phase 3（加固）─ 大部分独立
  ├── 3.1 信号融合 ← 独立（纯前端改动）
  ├── 3.2 测试 ← 独立
  ├── 3.3 PWA ← 独立
  └── 3.4 移动端 ← 独立

Phase 4（生态）─ 依赖 Phase 1 的 Supabase
  ├── 4.1 图谱生成 ← 独立脚本
  └── 4.2 社区贡献 ← 依赖 1.1

Phase 5（B 端）─ 依赖 Phase 1-4
  ├── 5.1 管理后台 ← 依赖 1.1, 2.1, 4.1
  └── 5.2 报告导出 ← 依赖 5.1
```

---

> **文档版本**：2026-08-17
> **适用 AI 工具**：阿里云百炼 TokenPlan、通义灵码、GitHub Copilot、Cursor
> **使用方式**：将每个模块的提示词直接粘贴给 AI 助手，按优先级顺序执行。