# Cogno Reader 安全与稳定性审计报告

> 审计日期：2026-08-17
> 审计范围：全部依赖项、构建配置、运行时安全、数据隐私、许可证合规

---

## 一、审计结论

**总体评级：C 级（原型可用，不可直接商用）**

React + TypeScript 底子稳固，依赖数量少是优势。但存在 **1 个高危依赖**（WebGazer.js）和 **多项缺失的安全配置**，在商业化前必须修复。

---

## 二、依赖项逐项分析

### 2.1 React 18.3.1 — ✅ 无风险

- **稳定性**：成熟的生产级框架，大版本 18 已被广泛验证
- **安全性**：Meta 持续维护，安全公告响应及时。React 19 已发布但 18 仍可继续使用
- **建议**：可暂不升级，商业化稳定后考虑迁移到 React 19

### 2.2 TypeScript 5.5.4 — ✅ 无风险

- **稳定性**：编译器本身极其稳定
- **安全性**：编译期类型检查从源头杜绝了 `undefined is not a function` 类运行时错误，这是项目最坚实的安全保障
- **建议**：保持跟随小版本升级

### 2.3 Vite 5.4.2 — ⚠️ 有已知漏洞（仅开发环境）

`npm audit` 报告 2 个漏洞：

| 漏洞 | 严重度 | CVSS | 影响范围 |
|------|--------|------|---------|
| esbuild 响应泄露 | 中度 | 5.3 | 仅 `vite dev` |
| Vite `.map` 路径遍历 | 高危 | 7.5 | 仅 `vite dev`（Windows 更严重） |

**关键事实**：两个漏洞都 **只影响开发服务器**，`npm run build` 产出的静态文件完全不受影响。生产环境如果部署的是 `dist/` 目录下的纯静态文件，这两个漏洞不构成威胁。

**当前配置加剧风险**：`vite.config.ts` 中 `host: true` 将开发服务器暴露到局域网，增加了攻击面。

**修复方案**：
- 升级到 Vite 6.4.3+（修复了路径遍历），或 Vite 8.x（最新）
- 开发时使用 `host: 'localhost'` 而非 `0.0.0.0`
- 升级是 breaking change，需要适配 Vite 6/8 的 API 变更

### 2.4 Cytoscape 3.30.2 — ✅ 无风险

- **稳定性**：图形可视化领域的事实标准库，维护活跃
- **安全性**：纯渲染库，不涉及网络请求或数据处理
- **建议**：无需变更

### 2.5 Dexie 4.0.8 — ✅ 无风险

- **稳定性**：IndexedDB 封装的事实标准，API 稳定
- **安全性**：操作仅限于浏览器本地存储，无网络通信
- **建议**：无需变更。Phase 1 接入 Supabase 后，Dexie 降级为本地缓存层，保留使用

### 2.6 pdfjs-dist 4.0.0 — ⚠️ 需关注

- **稳定性**：Mozilla 官方维护，质量可靠，没有问题
- **安全性**：PDF 格式复杂度高，历史上 PDF.js 多次出现 XSS 漏洞（恶意构造的 PDF 可执行任意 JS）。4.0.0 发布于 2024 年，需关注 Mozilla 安全公告
- **风险场景**：用户上传任意来源的 PDF 文件，如果 PDF 内嵌恶意 JS，可能在浏览器中执行
- **修复方案**：
  - 升级到 pdfjs-dist 最新稳定版
  - 在 PDF 渲染时禁用 JavaScript 执行（PDF.js 有 `disableScripting` 选项）
  - 添加 CSP 头限制脚本来源

### 2.7 WebGazer.js — ❌ 高危（三重风险）

**文件**：`public/vendor/webgazer.js`（1.9MB，2016 年版本）

这是整个项目最严重的风险点，同时存在稳定性、安全性、许可证三个维度的问题：

#### 2.7.1 稳定性风险

| 问题 | 详情 |
|------|------|
| 停止维护 | Brown University 学术项目，2016-2018 年后无实质更新 |
| 浏览器兼容性 | `getUserMedia`、Canvas API 近年有 breaking changes，未适配 |
| 无类型定义 | 1.9MB 单文件，无 TypeScript 类型，编译期无法检查 |
| 校准不稳定 | 8 点校准流程繁琐，精度受光照/角度/眼镜影响大 |
| 降级路径脆弱 | 当前仅降级为鼠标代理，手机/平板完全不可用 |

#### 2.7.2 安全性风险

| 问题 | 详情 |
|------|------|
| 无安全审计 | 9 年前的学术代码，未经任何第三方安全审查 |
| 摄像头权限 | 获得 `getUserMedia` 权限后可访问摄像头视频流 |
| 代码不透明 | 单文件 1.9MB，内部实现完全不可知 |
| 无 SRI 保护 | `index.html` 中加载此脚本没有 integrity 哈希 |
| 无来源验证 | 即使被 CDN 或中间人篡改也无法检测 |

#### 2.7.3 许可证风险（商业化致命）

```
WebGazer.js License: GPLv3
例外条款：估值 < $100 万的公司可使用 LGPLv3
```

**GPLv3 的传染性**：如果你的产品使用了 GPLv3 代码，**整个前端代码必须以 GPLv3 开源**。这意味着：
- 所有竞争对手可以自由复制、修改、分发你的前端代码
- 无法以专有软件形式销售
- 估值超过 $100 万后，连 LGPLv3 例外也失效

**修复方案**（三选一）：

| 方案 | 成本 | 效果 |
|------|------|------|
| A. 替换为 @mediapipe/face_mesh | 2-3 天 | Google 维护，Apache 2.0 许可，精度更高 |
| B. 完全移除眼动依赖，走纯行为信号 | 1 天 | 零风险，但失去核心差异化功能 |
| C. 联系 Brown 团队购买商业许可 | 不确定 | 保留现有代码，但许可谈判不可控 |

**推荐方案 A**：用 MediaPipe Face Mesh 替代。它是 Google 维护的正式产品，Apache 2.0 许可证（商业友好），提供人脸关键点检测（468 个点），可用于推断视线方向，且支持 WASM/WebGL 加速。

---

## 三、安全配置缺失

### 3.1 无内容安全策略（CSP）— 严重

`index.html` 中没有任何 CSP 配置。CSP 是防御 XSS 攻击的第一道防线。

**缺失的影响**：
- 无法阻止内联脚本执行
- 无法限制可以加载资源的域名
- 恶意 PDF 中的 JS 可能突破沙箱

**修复方案**：在 `index.html` 中添加：

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; 
           script-src 'self'; 
           style-src 'self' 'unsafe-inline'; 
           img-src 'self' data: blob:; 
           media-src 'self' blob:; 
           connect-src 'self' https://*.supabase.co https://api.deepseek.com http://localhost:*;
           frame-src 'self' blob:;
           worker-src 'self' blob:;" />
```

### 3.2 无子资源完整性（SRI）— 中等

`public/vendor/webgazer.js` 作为外部脚本加载，但没有 `integrity` 属性。

**修复方案**：生成哈希并添加到 script 标签：
```html
<script src="/vendor/webgazer.js" 
  integrity="sha384-xxxxx" 
  crossorigin="anonymous"></script>
```

### 3.3 API Key 存 localStorage — 中等

LLM API Key 存 `localStorage`，可被 XSS 攻击读取（`localStorage.getItem(...)` 仅需一行 JS）。

**修复方案**：
- 短期：改用 `sessionStorage`（标签页关闭即清除）
- 长期：Phase 1 实施后，API Key 由服务端网关管理，前端不再持有

### 3.4 开发服务器暴露 — 低

`vite.config.ts` 中 `host: true` 将开发服务器绑定到 `0.0.0.0`，局域网内任意设备可访问，结合 Vite 的路径遍历 CVE 增加了信息泄露风险。

**修复方案**：开发时使用 `host: 'localhost'`，仅本机访问。

### 3.5 无 CSRF 防护 — 暂无影响（Phase 1 后需关注）

当前没有后端，CSRF 不适用。但接入 Supabase 后，Supabase Auth 默认使用 JWT + HttpOnly Cookie，已内置 CSRF 防护，无需额外配置。

### 3.6 无速率限制 — 暂无影响（Phase 1 后需关注）

当前 AI 调用走用户自己的 API Key，频率由用户控制。Phase 1 接入服务端网关后，需要添加请求速率限制，防止滥用。

### 3.7 依赖锁文件未经审计 — 低

`package-lock.json` 存在但未经过 `npm audit` 签名验证。攻击者可能通过供应链攻击篡改依赖。

**修复方案**：CI 中添加 `npm audit --audit-level=high` 步骤，阻断含高危漏洞的构建。

---

## 四、数据隐私合规

### 4.1 当前状态

| 数据类别 | 存储位置 | 是否上传 | 合规状态 |
|---------|---------|---------|---------|
| 眼动坐标 | 内存（不持久化） | 不上传 | ✅ 安全 |
| 认知状态采样 | IndexedDB | 不上传 | ✅ 安全 |
| 阅读文档 | IndexedDB | 不上传 | ✅ 安全 |
| 摄像头视频流 | 不存储 | 不上传 | ✅ 安全 |
| API Key | localStorage | 仅发往配置的 AI 端点 | ⚠️ 可被 XSS 读取 |
| 阅读上下文片段 | 不存储 | 发往 AI 端点 | ⚠️ 无隐私声明 |

### 4.2 缺失项

- 无隐私政策页面
- 无用户协议
- 无摄像头使用说明弹窗（首次授权前）
- 无数据删除功能
- 无数据导出功能
- 阅读上下文发往 AI 端点时，用户无感知

### 4.3 修复方案

详见 `COMMERCIALIZATION_PLAN.md` 模块 1.5。

---

## 五、运行时安全

### 5.1 错误边界

当前仅有一个 `ErrorBoundary.tsx`，但未确认其覆盖范围。如果认知引擎崩溃，可能影响整个阅读页面。

**建议**：在 `CognitiveEngine`、`AgentTrigger`、`eyeTracking` 三个关键模块外包裹独立的 try-catch，确保单个模块崩溃不影响其他功能。

### 5.2 第三方脚本加载

`webgazer.js` 通过运行时 `document.createElement('script')` 加载，如果 CDN 被劫持或文件被篡改，无法检测。

**建议**：替换 WebGazer 后，所有第三方脚本通过 npm 安装（带 lockfile 验证），不再运行时动态加载。

---

## 六、修复优先级与路线图

| 优先级 | 问题 | 预计工时 | 阻塞商业化？ |
|--------|------|---------|------------|
| **P0** | 替换 WebGazer.js（许可证 + 安全） | 2-3 天 | ✅ 是 |
| **P0** | 添加 CSP 头 | 0.5 天 | ✅ 是 |
| **P1** | 升级 Vite 到安全版本 | 0.5 天 | 否（仅影响开发） |
| **P1** | 升级 pdfjs-dist + 禁用脚本 | 0.5 天 | 否 |
| **P1** | API Key 改用 sessionStorage | 0.5 天 | 否 |
| **P2** | 添加 SRI 哈希 | 0.5 天 | 否 |
| **P2** | 开发服务器绑定 localhost | 0.1 天 | 否 |
| **P2** | CI 中加 npm audit | 0.5 天 | 否 |
| **P2** | 关键模块 try-catch 包裹 | 0.5 天 | 否 |

---

## 七、许可证合规检查清单

| 依赖 | 许可证 | 商业友好？ | 注意事项 |
|------|--------|-----------|---------|
| React | MIT | ✅ | - |
| TypeScript | Apache 2.0 | ✅ | - |
| Vite | MIT | ✅ | - |
| Cytoscape | MIT | ✅ | - |
| Dexie | Apache 2.0 | ✅ | - |
| pdfjs-dist | Apache 2.0 | ✅ | - |
| **WebGazer.js** | **GPLv3** | ❌ | **必须替换** |

---

## 八、长期安全建议

1. **年度第三方安全审计**：商业化后聘请安全公司做渗透测试
2. **漏洞赏金计划**：通过 HackerOne 等平台接收外部安全报告
3. **依赖自动更新**：配置 Dependabot 或 Renovate 自动提交依赖升级 PR
4. **SOC 2 认证**：如果进入 B 端市场，需通过 SOC 2 Type II 审计
5. **GDPR/PIPL 合规**：如服务欧盟/中国用户，需聘请隐私律师审核

---

> **下次审计时间**：Phase 1 完成后（引入 Supabase + Stripe 后需重新评估）
> **审计工具**：`npm audit`、`npm outdated`、`npx license-checker`