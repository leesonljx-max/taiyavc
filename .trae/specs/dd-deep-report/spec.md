# 尽调工作台 · 深度尽调报告（A4 图文文档版）— 实施规格

版本：v1.0（待批准）
日期：2026-11-10
需求原话：尽调报告内容单薄；按九大模块生成核心问题，结合资料中心资料与全网检索一起分析；每个板块输出「内容 + 分析 + 结论」；报告采用文字 + 图表 + 网络/资料中心核心图片（技术拓扑图、流程图等）；页数不设上限，按分析需要；版式参考已上传的《泰亚投资管理系统_功能与技术架构报告.pdf》。

## 1. 目标与验收

新增第三种报告产物「深度报告」（deck type = `DEEP`），与现有「资料简报 BRIEF」「汇报 PPT FINAL」并存：

1. 以九大模块为骨架，每模块先给 3–5 个投委会核心问题，再逐题给出「资料与事实 → 分析 → 结论」。
2. 每个模块的输入同时包含：资料中心该模块上传文档全文（PDF/PPTX/DOCX 已提取文本）、文本框、人工结论、模块报告，以及全网研究的事实与来源正文。
3. 报告包含由真实数据计算出的图表：模块覆盖度、事实/来源数量、证据等级分布、关键数值事实表。
4. 报告包含图片：资料中心截图、从 PDF/PPTX 资料中按页提取的架构图/流程图/示意图、公开来源页面的 og:image（限量、失败静默）。
5. 输出为 A4 纵向文档（封面、目录、章节页、正文、附录），页数由内容自然决定（预计 35–60 页），不做固定页数限制；浏览器「打印 → 另存为 PDF」得到正式 PDF，版式与参考 PDF 一致（深海军蓝 + 金色、象牙白正文）。
6. 不改变 BRIEF/FINAL 的生成逻辑、版式与导出能力。

验收标准：

- 点击「深度报告」后可轮询到 READY 并打开 A4 预览；生成失败有明确错误。
- 九大模块每模块至少 1 个章节页 + 2 个正文页；每模块 3–5 个问题，且每题有回答。
- 图表数据与上下文统计一致；图片至少包含资料中心截图或文档提取图（有资料时）。
- 打印预览每页为 A4，无跨页截断、无空白页、页码连续。
- `npx tsc --noEmit`、`npm test`、`npm run build` 全绿。

## 2. 关键决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 存储 | 复用 `DDSlideDeck`，`type='DEEP'`，文档规格存 `specJson`，`slideCount` 存页数 | 零数据库迁移；列表/指纹/权限/轮询全部复用 |
| 页面模型 | 服务端组装 `DeepDocSpec.pages[]`，每页固定 A4 高度，按块高度预算装页 | 页数动态且打印稳定，避免 CSS 自动分页溢出 |
| 导出 | 前端打印（`window.print`）+ 浏览器另存 PDF | 与参考 PDF 一致；不引入服务端 PDF 依赖 |
| 图片 | 截图 + 本地 PDF/PPTX 按页提取 + 公开来源 og:image（SSRF 防护） | 满足「资料中心 + 全网」图片要求 |
| 内容生成 | 每模块 1 次 LLM（串行），再 2 次综述 LLM；失败按模块兜底 | 控制单次输出长度，单模块失败不影响整份报告 |
| 缺口 | DEEP 不因 BLOCKING 缺口阻断，只在报告「资料局限」章节列明 | 深度报告定位是分析草稿，不是投决文件 |

## 3. 现状与复用点

| 能力 | 现有文件 | 复用方式 |
| --- | --- | --- |
| 九大模块定义 | `src/lib/dd-workbench/template.ts` | `DD_TEMPLATE_MODULES` 的 key/name/coreQuestion |
| 项目/事实/来源/资料/缺口上下文 | `src/lib/dd-deck/context.ts` | `buildDeckContext(projectId)` 作为基础上下文 |
| 队列与状态恢复 | `src/lib/dd-deck/queue.ts` | `createDeck`/`enqueueDeck`/`pump`，新增 DEEP 分支 |
| 指纹复用 | `src/lib/dd-research/fingerprint.ts` | `computeDeckFingerprint` 扩展 DEEP 文档内容签名 |
| 全页图片与按页文本 | `src/lib/project-interpretation/bp-images.ts` | `buildPagedBpText(buffer,fileName)`、`extractBpPageImages(buffer,fileName,pageNums,key)` |
| DeepSeek JSON | `src/lib/dd-research/llm.ts` | `callDeepSeekJson({ module:'dd-deck' })` |
| 报告查看器 | `src/components/dd-workbench/DDDeckViewer.tsx` | `type==='DEEP'` 分支渲染 A4 文档 |
| 报告 API | `src/app/api/dd/decks/[projectId]/route.ts`、`src/app/api/dd/deck/[deckId]/route.ts` | POST 接受 DEEP；GET 返回 DEEP 指纹；详情原样返回文档 spec |

## 4. 类型与页面组装（新增 `src/lib/dd-deep/spec.ts`）

```ts
export type DeepBlock =
  | { type: 'heading'; text: string; level?: 1 | 2 }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'qa'; items: Array<{ question: string; answer: string; refs?: string[] }> }
  | { type: 'table'; title?: string; columns: string[]; rows: string[][]; note?: string }
  | { type: 'chart'; title: string; unit?: string; note?: string; chart:
      | { kind: 'bar'; series: Array<{ label: string; value: number; color?: string }> }
      | { kind: 'donut'; series: Array<{ label: string; value: number; color?: string }> } }
  | { type: 'image'; url: string; caption: string; source?: string }
  | { type: 'callout'; title?: string; text: string; tone?: 'gold' | 'red' | 'teal' }

export interface DeepPage {
  pageNo: number
  kind: 'cover' | 'toc' | 'section' | 'content' | 'appendix'
  sectionNo?: string
  sectionTitle?: string
  kicker?: string
  blocks: DeepBlock[]
}

export interface DeepDocSpec {
  kind: 'DOCUMENT'
  type: 'DEEP'
  title: string
  subtitle: string
  projectName: string
  companyFullName?: string
  industry?: string
  generatedAt: string
  theme: 'navy-gold'
  pageCount: number
  toc: Array<{ no: string; title: string; page: number }>
  stats: { sourceCount: number; factCount: number; docCount: number; imageCount: number }
  pages: DeepPage[]
}
```

同文件实现：

- `estimatePageCount(spec)`：返回 `pages.length` 并回写 `pageCount`。
- `coerceDeepDocSpec(spec)`：删空块、截断超长段落（1200 字）、表格最多 8 行 × 6 列、图片仅保留 `/` 或 `https?://` 开头的 URL、重排页码与目录。
- `assembleDeepDocSpec(input)`：输入项目信息、九模块内容、综述、图表数据、图片、资料局限，生成完整 `pages`。
  - 固定顺序：封面 → 目录 → 「执行摘要」章节页 + 正文 2–3 页 → 「行业与时机」1–2 页 → 九大模块（每模块章节页 + 正文 2–4 页）→ 「风险、估值与结论」2–3 页 → 「资料局限与待验证」1 页 → 附录（证据索引、来源索引）。
  - 目录页在全部正文装页完成后回填真实页码。
- 装页高度预算（内容区约 880px）：
  - heading 46 / paragraph `ceil(len/42)*26+10` / bullets `Σ(ceil(len/40)*24+8)` / qa `Σ(28+ceil(answer/40)*24+12)` / table `rows*30+56` / chart 330 / image 360 / callout 96。
  - 超过预算即新建 `content` 页；标题不单独留在页尾（heading 后至少跟一个块）。
- 每模块正文结构固定：
  1. `heading` 模块名 + `qa` 核心问题（3–5 题）
  2. `heading` 资料与发现 + `paragraph`/`bullets`
  3. `heading` 分析 + `bullets`（驱动、反证、竞争影响、待验证）
  4. `heading` 结论 + `callout`
  5. 可选 `table`（关键指标）、`chart`、`image`（技术拓扑/流程图）

## 5. 深度上下文（新增 `src/lib/dd-deep/context.ts`）

`buildDeepContext(projectId): Promise<DeepContext>`：

1. 调 `buildDeckContext(projectId)` 得到项目、九模块、事实、来源、缺口、统计。
2. 读取 `DDModuleResource` 全字段：`documents`（解析 `{id,fileName,fileUrl,fileType,text,uploadedAt}`）、`textBlocks`、`screenshots`、`conclusion`、`reportJson`、`verificationJson`、`analysisJson`。
3. 读取最新 `DDResearchRun.sources` 的 `content`/`snippet`（每模块按 A→D 等级取前 4 条，每条截断 1200 字）。
4. 每模块生成 `DeepModuleContext`：

```ts
{
  moduleKey, moduleName, coreQuestion, coverage,
  facts: DeckFact[],                    // 最多 12 条
  sources: Array<{ ref; title; url; domain; grade; excerpt }>, // 最多 4 条
  documents: Array<{ id; fileName; fileUrl; fileType; text; textLength }>, // 单篇 ≤4000 字
  textBlocks: string[],                 // 最多 6 条，每条 ≤800 字
  screenshots: Array<{ id; url; fileName }>,
  humanConclusion: string | null,
  report: DeckModuleReport | null,
  gaps: Array<{ label; severity; status }>,
}
```

5. 模块资料总预算 8000 字：按文档顺序拼接，超出即停止并记录 `truncatedDocs` 数量（写入资料局限）。
6. `buildDeepCharts(context)`：纯函数，输出：
   - `coverage`：九模块覆盖度（%）柱状；
   - `grades`：A/B/C/D 事实数环形；
   - `evidenceByModule`：九模块「事实 / 来源 / 资料」三列对比表；
   - `financeFacts`：`FINANCE_ECONOMICS` 模块数值事实表（无数据则不输出）。
7. `collectImages(context)` 委托 `images.ts`（见 §7）。

## 6. 内容生成（新增 `src/lib/dd-deep/writer.ts`）

### 6.1 模块内容

`generateModuleContent(context, module): Promise<DeepModuleContent>`，每模块一次 `callDeepSeekJson`（`module:'dd-deck'`，`maxTokens: 3200`，`timeoutMs: 240000`，`temperature: 0.3`）。

```ts
export interface DeepModuleContent {
  moduleKey: string
  headline: string
  questions: Array<{ question: string; answer: string; refs?: string[] }> // 3–5
  facts: string[]        // 资料与发现，4–6 条，带 [F#]/[资料N] 引用
  analysis: string[]     // 投资含义/驱动/反证/待验证，4–6 条
  conclusion: string     // 本模块结论，≤120 字
  metrics?: Array<{ label: string; value: string; hint?: string }> // 0–4
  limitations?: string[] // 资料不足或冲突
}
```

Prompt 必须包含：项目概况、模块核心问题、模块人工结论、资料全文摘录（带 `[资料1]` 编号）、事实 `[F#]`、来源 `[E#]`、缺口。要求：

- 问题必须可被资料或公开信息回答，禁止「请补充资料」式伪问题；
- 回答先给判断，再给依据与引用；
- 不得编造公司收入、订单、客户、估值数字；缺失时写「公开信息不足」并给验证路径；
- 只输出 JSON。

### 6.2 综述

两次调用：

1. `generateExecutiveSummary(context, modules)` → `{ headline, paragraphs[2–3], bullets[4–6], conclusion }`；
2. `generateOutlookAndRisks(context, modules)` → `{ industry: {headline, paragraphs, bullets}, timing: {...}, risks: [{title, detail, mitigation, refs}], valuation: {headline, bullets, metrics}, conclusion: {headline, conditions[4], nextSteps[4]} }`。

### 6.3 兜底

任一 LLM 调用失败：

- 模块兜底 `fallbackModuleContent(moduleContext)`：用人工结论/模块报告 summary 生成结论；用事实与文档标题生成 3 个问题与回答；分析由「机会 / 风险 / 缺口 / 验证路径」四段模板组成；引用只使用真实 `[F#]`。
- 综述兜底：用统计数字、模块结论、缺口汇总拼装。
- 兜底内容必须标记 `dataLimited: true`，在报告「资料局限」页列明。

## 7. 图片管线（新增 `src/lib/dd-deep/images.ts`）

`collectDeepImages(context): Promise<{ images: DeepImage[]; notes: string[] }>`，上限 10 张：

1. **资料中心截图**（优先级最高）：每模块最多 2 张，按模块顺序取 `screenshots`，URL 原样使用。
2. **文档关键页提取**：仅 `PROJECT_ENTITY`、`PRODUCT_TECHNOLOGY`、`MARKET_CUSTOMERS`、`COMMERCIALIZATION` 四个模块；每模块最多 1 篇 PDF/PPTX、最多 2 页，全项目最多 6 页。
   - 文档路径：`fileUrl` 匹配 `^/research-docs/([A-Za-z0-9._-]+)$` → `public/research-docs/<name>`；读取失败跳过。
   - 用 `buildPagedBpText` 得到 `[第N页]` 文本，按关键词 `架构|拓扑|流程|示意|技术路线|产品|平台|系统|部署|客户|订单` 命中数排序选页。
   - 调 `extractBpPageImages(buffer, fileName, pageNums, 'deep-'+projectId+'-'+moduleKey)`，URL 直接用返回的 `/api/uploads/interpretation-images/...`。
   - 单篇文件 > 30MB、提取耗时 > 20s 或失败则跳过并记 note。
3. **公开来源 og:image**：最多 4 张，仅 A/B 级来源。
   - `fetch(url, { redirect:'follow', signal: AbortSignal.timeout(5000) })`；仅 `http/https`。
   - 先 `dns.promises.lookup` 校验目标 IP 非私网/回环/链路本地（`127/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、`::1`、`fc00::/7`、`fe80::/10`），DNS 解析失败跳过。
   - 响应 `content-type` 必须 `image/*`，`content-length` ≤ 2MB；超限跳过。
   - 图片以 `<img src>` 直接引用原始 URL，不落盘；`referrerPolicy="no-referrer"`。
4. 每张图附 `caption` 与 `source`（文档名/来源标题+域名）；无来源图片不进入报告。

## 8. 队列与指纹

### 8.1 `src/lib/dd-deck/queue.ts`

- `createDeck(projectId, type: DeckType, ...)`：type 支持 `'DEEP'`；复用逻辑不变。
- `generateDeck` 增加分支：

```ts
if (deck.type === 'DEEP') {
  await generateDeepDeck(deckId)   // src/lib/dd-deep/pipeline.ts
  return
}
```

- 新增 `src/lib/dd-deep/pipeline.ts`：`generateDeepDeck(deckId)`：
  1. `buildDeepContext` → `collectDeepImages` → 逐模块 `generateModuleContent`（每完成 1 个模块 `prisma.dDSlideDeck.update({ data:{ status:'GENERATING' } })` 作为心跳，避免 20 分钟恢复逻辑误判）→ 2 次综述调用；
  2. `assembleDeepDocSpec` → `coerceDeepDocSpec`；
  3. `dDSlide.deleteMany`（清空幻灯片）→ `dDSlideDeck.update({ status:'READY', specJson, slideCount: pageCount, generatedAt })`；
  4. 不调用 `renderDeckPptx`；`pptxUrl` 保持 null；
  5. 失败写 `FAILED` + 前 800 字错误；单模块失败走兜底并继续。
- `STALE_MS` 维持 20 分钟（心跳保证 DEEP 不被误回收）。

### 8.2 `src/lib/dd-research/fingerprint.ts`

- `computeDeckFingerprint(projectId, type: 'BRIEF'|'FINAL'|'DEEP')`。
- 仅 DEEP 追加 `deepResources` 签名：每模块 `{ moduleKey, docs: documents.map(d => ({ id, fileName, len: text.length, head: text.slice(0,200), tail: text.slice(-200) })), screenshots: ids, conclusionLen }`，整体 hash。新增资料正文或截图会触发新版本。

## 9. API 调整

| 路由 | 改动 |
| --- | --- |
| `src/app/api/dd/decks/[projectId]/route.ts` | POST `type` 允许 `DEEP`；DEEP 不计算/不阻断 blocking gaps；GET `current` 增加 `DEEP` 指纹 |
| `src/app/api/dd/deck/[deckId]/route.ts` | 无结构改动；`spec` 为 `DeepDocSpec`，`slides` 为空数组 |
| `src/lib/dd-deck/spec.ts` | `DeckType` 增加 `'DEEP'`；`DeckSpec.type` 不变（DEEP 不复用 DeckSpec） |

## 10. 前端

### 10.1 `src/components/dd-workbench/DDResearchBar.tsx`

- `DeckSummary.type: 'BRIEF' | 'FINAL' | 'DEEP'`。
- 按钮顺序：「资料简报」「汇报 PPT」「深度报告」，深度报告用 `btn-primary` 样式区分；原「尽调报告」显示名改为「汇报 PPT」。
- `currentFingerprints` 改为 `{ BRIEF, FINAL, DEEP }`。
- `deckButtonLabel`/`generateDeck`/`latestDeck`/`deckIsCurrent` 支持 DEEP；生成中文案「深度报告生成中…」。
- 底部版本摘要追加「深度报告 vN」。

### 10.2 新增 `src/components/dd-workbench/DeepReportDocument.tsx`

- Props：`{ spec: DeepDocSpec }`。
- A4 画布 794×1123px；页面按 `spec.pages` 渲染；缩放由父容器控制（`transform: scale`）。
- 视觉（对齐参考 PDF）：
  - 主色 `#0B1F33` 深海军蓝、强调 `#C9A227` 金、正文 `#1F2937`、纸色 `#FFFFFF`、页眉分隔线 `#D9DEE5`；
  - 封面：深蓝满版 + 金色细线 + 标题 + 副标题 + 项目名 + 日期 + 「机密 · 仅供投资决策使用」；
  - 章节页：深蓝满版 + 金色大号章节编号 + 章节标题；
  - 正文页：左上章节名、右上项目名、页脚页码；标题金色短线；正文 11.5px/1.9，两端对齐；
  - 表格：深蓝表头白字、斑马纹；图表：内联 SVG（柱状/环形），金色/青绿/灰蓝配色；
  - 图片：居中、最大高 300px、`object-fit: contain`、图注与来源。
- 打印：注入 `@page { size: A4; margin: 0 }`；`@media print` 下隐藏工具栏/阴影，`.deep-page { width:210mm; height:297mm; page-break-after:always; overflow:hidden }`；最后一页后不加空白页。
- 导出：工具栏「🖨 打印 / 导出 PDF」调用 `window.print()`。

### 10.3 `src/components/dd-workbench/DDDeckViewer.tsx`

- 读取 `spec.kind === 'DOCUMENT'` 或 `deck.type === 'DEEP'` 时进入 DEEP 模式：
  - 工具栏保留标题/版本/页数/关闭，新增缩放（适应宽度 / 100%）、打印按钮；
  - 隐藏翻页、缩略图、PPTX 下载、PNG/ZIP 导出；
  - 舞台改为纵向滚动容器，渲染 `DeepReportDocument`。
- BRIEF/FINAL 路径完全不变。

## 11. 成本与护栏

- LLM：9 次模块 + 2 次综述 = 11 次/份；单模块输入资料 ≤8000 字；`maxTokens` 模块 3200、综述 2600。
- 图片：≤10 张；文档提取 ≤6 页；网络图片 ≤4 张、单张 ≤2MB、5s 超时。
- 无来源数字不得进入结论；冲突事实保留并标注。
- DEEP 生成可复用指纹；`force` 才重跑。
- 单份报告预计 35–60 页，`slideCount` 记录真实页数。

## 12. 测试与验证

新增 `tests/dd-deep.test.ts`（纯函数，不依赖 DB/网络）：

1. `assembleDeepDocSpec`：九模块全部出现；页码连续；目录页码等于章节页实际页码；页数 ≥ 25。
2. 装页：1000 字长段落自动拆到多页且不超预算；heading 不落单。
3. `coerceDeepDocSpec`：空块/非法图片 URL 被剔除；表格行列被截断；页码重排。
4. `buildDeepCharts`：覆盖度 9 项、等级分布合计等于事实数、无财务事实时不输出财务表。
5. `fallbackModuleContent`：问题 ≥3、结论非空、引用均来自真实 `[F#]`。
6. `estimatePageCount` 与 `pageCount` 一致。

全量验证：

- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- 浏览器手测：生成深度报告 → 打开 A4 预览 → 检查目录/章节/图表/图片 → 打印预览为 A4 → 保存 PDF。
- `package.json` 版本 `2.7.4`。

## 13. 不在本轮范围

- 服务端生成 PDF 文件（用浏览器打印替代）。
- DEEP 的 PPTX 导出。
- 修改 BRIEF/FINAL 的模板、页数与导出。
- 把全部历史文档做 OCR（仅使用已提取文本；无文本的扫描件不额外 OCR）。
- 网络图片落盘缓存。

## 14. 批准

请回复「批准」开始执行 `tasks.md`；如需调整章节结构、图片数量或版式，请直接指出条目。
