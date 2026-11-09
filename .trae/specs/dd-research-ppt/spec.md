# 尽调工作台 · 全网资料自动尽调与 PPT 报告 — 实施规格

版本：v1.0（待批准）
日期：2026-11-09
需求来源：`/Users/leeson/Desktop/投资管理系统/Investrask/dd_research_doc/投资管理系统_尽调工作台_全网资料与PPT报告_技术设计文档.docx`

## 1. 目标

把现有尽调工作台从「按模块手工找资料 + 文字报告」升级为：

1. 项目维护人在工作台点击「一键全网尽调」，系统按九大模块检索公开信息、抽取可核验事实、标记来源与覆盖度。
2. 资料中心新增「非分类资料」：上传不阻塞、扫描件后台 OCR、AI 建议归类、人工可改；未分类资料同样参与报告。
3. 研究完成 + 资料上传后，只对「网络找不到且缺失会阻塞核心问题」的资料生成缺口提醒；上传后按内容自动关闭，合伙人可豁免。
4. 生成两份 16:9 PPT 样式报告：资料简报 Brief（12–15 页）、尽调报告 Final（22–26 页）。
5. 导出同时支持 PNG 图片 + ZIP 与原生可编辑 PPTX。

## 2. 已确认决策

| 决策 | 选择 |
| --- | --- |
| 导出格式 | PNG/ZIP + 原生可编辑 PPTX |
| 触发方式 | 仅手动触发，不随阶段变更自动检索 |
| 本轮范围 | 完整闭环：研究 + 非分类资料/OCR/归类 + 缺口 + Brief + Final + 导出 |
| 队列 | 复用年度报告的进程内队列 + 数据库状态恢复，不引入 Redis / pg-boss |
| 页面入口 | 现有 `/research/[projectId]` 尽调工作台内，不新增独立路由 |

## 3. 现状与复用点

| 能力 | 现有文件 | 复用方式 |
| --- | --- | --- |
| 九大模块 | `src/lib/dd-workbench/template.ts` | 模块 key/名称/核心问题作为研究与报告骨架 |
| 资料中心 | `src/lib/dd-workbench/resources.ts`、`src/components/dd-workbench/DDWorkbenchShell.tsx` | 新增非分类分段控件，不改现有模块资料结构 |
| 文档提取/OCR | `src/lib/document-extract.ts` | `extractTextFromFile(buffer, name, type, { skipOcr })` |
| 异步队列范式 | `src/lib/post-investment/extract-queue.ts`、`src/lib/annual-report/queue.ts` | 复制「数据库状态 + 轮询恢复」模式 |
| 双源检索 | `src/lib/tavily-search.ts` | `searchWebDual(query, { mode: 'collect', module: 'dd-research', cacheTtlHours: 12 })` |
| DeepSeek JSON | `src/lib/dd-harness/agent.ts` 的 `parseAgentJson` | 事实抽取、归类、Deck 文案统一使用 |
| 图片导出 | `src/app/annual-reports/[id]/page.tsx` | `html-to-image` + `JSZip` 浏览器端导出 |
| 权限 | `src/lib/research-permissions.ts` | `canViewResearchProject` / `canEditResearchProject` |

## 4. 数据模型（仅新增，不改现有字段）

在 `prisma/schema.prisma` 末尾新增 7 个模型，并在 `Project` 增加 4 个关系字段：

```prisma
// Project 内新增
ddResearchRuns       DDResearchRun[]
ddUnclassifiedAssets DDUnclassifiedAsset[]
ddGaps               DDGap[]
ddSlideDecks         DDSlideDeck[]
```

模型字段与索引：

- `DDResearchRun`：`id/projectId/batchId?/status(QUEUED|RUNNING|PARTIAL|DONE|FAILED)/phase(PLAN|SEARCH|EXTRACT|SCORE|GAP)/progress/scopeJson?/statsJson?/error?/startedAt?/finishedAt?/createdAt/updatedAt`；索引 `[projectId, createdAt]`、`[status]`。
- `DDModuleResearch`：`id/runId/moduleKey/status(PENDING|RUNNING|READY|PARTIAL|INSUFFICIENT|FAILED)/coverage/factCount/sourceCount/gapCount/error?/updatedAt`；唯一 `[runId, moduleKey]`。
- `DDResearchSource`：`id/runId/moduleKey/url/title?/domain/publishedAt?/snippet?/content?/sourceType(WEB|OFFICIAL|MEDIA|REPORT)/grade(A|B|C|D)/contentHash?/fetchedAt`；唯一 `[runId, url]`，索引 `[runId, moduleKey]`。
- `DDResearchFact`：`id/runId/moduleKey/fact/value?/unit?/period?/quote?/sourceId?/confidence/grade/importance(CORE|NORMAL)/status(PENDING|CONFIRMED|REJECTED|CONFLICT)/createdBy?/createdAt`；索引 `[runId, moduleKey, status]`、`[sourceId]`。
- `DDUnclassifiedAsset`：`id/projectId/fileName/fileUrl/fileType/fileSize/text?/ocrStatus(PENDING|PROCESSING|READY|FAILED)/ocrConfidence?/pageCount?/classificationJson?/status(UNCLASSIFIED|CLASSIFIED)/moduleKey?/contentHash?/uploadedBy/error?/createdAt/updatedAt`；唯一 `[projectId, contentHash]`，索引 `[projectId, status]`。
- `DDGap`：`id/projectId/moduleKey/gapKey/label/severity(BLOCKING|RECOMMENDED)/reason/suggestedTypes/status(OPEN|RESOLVED|WAIVED)/resolvedBy?/resolvedAssetId?/resolvedAt?/waivedBy?/waivedAt?/waiveReason?/createdAt/updatedAt`；唯一 `[projectId, moduleKey, gapKey]`，索引 `[projectId, status, severity]`。
- `DDSlideDeck`：`id/projectId/type(BRIEF|FINAL)/status(QUEUED|GENERATING|READY|FAILED)/templateVersion/theme/slideCount/specJson?/pptxUrl?/generatedBy/generatedAt?/error?/createdAt/updatedAt`；索引 `[projectId, type, createdAt]`。
- `DDSlide`：`id/deckId/slideNo/layout/title/contentJson/notes?`；唯一 `[deckId, slideNo]`。

同步修改 `src/lib/token-accounting.ts` 的 `TokenModule`，新增 `dd-research`、`dd-ingest`、`dd-deck`；`src/lib/tavily-search.ts` 的 `SearchModule` 新增 `dd-research`。

## 5. 后端模块

### 5.1 `src/lib/dd-research/constants.ts`

- `DD_REQUIREMENTS: DDRequirement[]`：九大模块必备证据（gapKey、label、severity、reason、suggestedTypes、keywords）。
  - 主体工商、股权/cap table、审计/管理报表、订单台账、收入拆分、Term sheet 等公开信息拿不到的资料为 `BLOCKING`。
  - 市场规模、政策、专利、认证、客户案例、竞品份额、融资历史等为 `RECOMMENDED`。
  - 法务诉讼类固定 `RECOMMENDED`，理由写明「公开检索未发现不等于不存在，仍需法务核验」。
- `DD_SEARCH_BUDGET = { maxSearches: 45, maxResultsPerQuery: 5, maxSourcesPerModule: 8, contentMaxChars: 20000 }`。
- `gradeSource(url): 'A'|'B'|'C'|'D'`：政府/工商/专利/交易所 A；一线媒体/协会/研报/论文 B；普通媒体/聚合/企业稿 C；自媒体/论坛/无署名 D。
- `moduleStatusFromCoverage(coverage): 'READY'|'PARTIAL'|'INSUFFICIENT'`：≥0.75 READY，≥0.35 PARTIAL，否则 INSUFFICIENT。

### 5.2 `src/lib/dd-research/planner.ts`

- `buildQueryPlan(project, moduleKeys?)`：每模块 4–6 组查询，包含公司名/全称/行业/产品/轮次与当前年份；去重后总数 ≤45。
- 纯函数，无网络/数据库依赖，供单测。

### 5.3 `src/lib/dd-research/search.ts`

- `searchModuleSources(plan)`：逐模块串行、模块内查询并发 ≤3；调用 `searchWebDual`；按规范化 URL 去重；每条来源记录域名、等级、正文（截断 20k）；单项目搜索计数不超过预算。
- 不使用上传资料正文作为 query，只用公开实体。

### 5.4 `src/lib/dd-research/extract.ts`

- `extractModuleFacts(moduleKey, moduleName, coreQuestion, sources)`：单模块一次 DeepSeek。
- 输出 `{ facts: [{fact,value?,unit?,period?,quote,sourceIdx,confidence,importance}], conflicts: [...] }`。
- 校验：`sourceIdx` 越界丢弃；无 `quote` 丢弃；`confidence` 限制 0–1；同指标差异 >20% 输出 conflict；失败重试 1 次后返回空事实 + error。

### 5.5 `src/lib/dd-research/coverage.ts`

- `computeModuleCoverage(moduleKey, facts, sources)`：`min(1,coreFacts/3)*0.6 + min(1,sourceCount/5)*0.2 + (hasOfficial?0.2:0)`；返回 coverage、status、计数。

### 5.6 `src/lib/dd-research/gap.ts`

- `evaluateRequirementCoverage(requirement, factTexts, docTexts)`：关键词匹配（事实 + 摘录 + 上传文档）。
- `rebuildGaps(projectId, moduleResults)`：
  - 未覆盖且 severity=BLOCKING → OPEN BLOCKING。
  - 未覆盖且 severity=RECOMMENDED → OPEN RECOMMENDED。
  - 已覆盖且现有 gap 为 OPEN → RESOLVED（resolvedBy=AUTO）。
  - 已 WAIVED 不自动复活；资料删除/过期时由 `refreshGapsForProject` 重新 OPEN。
- `refreshGapsForProject(projectId)`：上传/归类/删除后调用。

### 5.7 `src/lib/dd-research/orchestrator.ts`

- `createResearchRun(projectId, { modules?, force?, userId })`：
  - 非 force 且存在 24h 内 `QUEUED/RUNNING/DONE/PARTIAL` → 返回已有 run（`existing: true`）。
  - 同项目同时仅允许 1 个 `QUEUED/RUNNING`。
- `runResearch(runId)`：PLAN 5 → SEARCH 20 → EXTRACT 55 → SCORE 75 → GAP 90 → DONE 100；每模块完成即写 `DDModuleResearch`；单模块失败标记 PARTIAL/FAILED 并继续；写 statsJson。
- 事实默认 `PENDING`；`CORE` 事实必须带 sourceId + quote。

### 5.8 `src/lib/dd-research/queue.ts`

- `enqueueResearch(runId)`、`recoverStale()`：并发 1；`RUNNING` 超 20 分钟重置为 QUEUED；进程重启后恢复。

### 5.9 `src/lib/dd-ingest/unclassified.ts` + `ocr-queue.ts`

- `createUnclassifiedAsset({ projectId, file, userId })`：
  - 保存到 `public/dd-unclassified/<timestamp-random>.<ext>`；
  - SHA-256 去重（同项目同 hash 直接返回已有 asset）；
  - `extractTextFromFile(..., { skipOcr: true })` 快速文本；
  - 建 `DDUnclassifiedAsset`（ocrStatus=PENDING，若已有文本则 READY），入 OCR 队列；≤3 秒返回。
- OCR 队列：并发 2；加载文件 → 完整 OCR → 更新 text/ocrStatus/ocrConfidence/pageCount；失败 FAILED + error；支持重试。
- `classifyAsset(assetId)`：DeepSeek 输出 `{ summary, candidates:[{moduleKey,confidence,rationale}], sensitivity }`；top ≥0.75 自动应用到模块，0.5–0.75 仅建议，<0.5 保持未分类。
- `applyAssetToModule(projectId, assetId, moduleKey|null)`：
  - 从旧模块 `DDModuleResource.documents` 移除 `assetId` 对应条目；
  - 新模块追加 `{ id: assetId, fileName, fileUrl, fileType, fileSize, text, uploadedAt }`；
  - 更新 asset.status/moduleKey；调用 `refreshGapsForProject`。
- 删除 asset 时同步移除模块文档引用并刷新缺口。

### 5.10 `src/lib/dd-deck/*`

- `spec.ts`：`DeckSpec`/`SlideSpec` 类型；`validateDeckSpec` 校验页数、标题长度、bullet 数量、evidenceRefs 格式（`^[EF]\d+$`）、layout 必填字段。
- `context.ts`：`buildDeckContext(projectId)` 汇总项目、九模块事实/来源/资料、模块报告、缺口汇总、统计。
- `writer.ts`：
  - `generateDeckContent(context, deckType)`：一次 DeepSeek 输出每模块的结论标题 + 3 条 bullet + 风险/机会；严格 JSON；失败回退到事实摘要。
  - `assembleBriefSpec(context, content)`：固定 14 页（封面、资料全景、结论摘要、九模块、缺口、下一步、来源附录）。
  - `assembleFinalSpec(context, content)`：固定 22 页（封面、投资摘要、项目全景、为什么可能成 5 页、为什么可能不成 3 页、风险矩阵、机会矩阵、风险机会对照、估值、条款回报、结论条件、投后验证、证据索引、待验证附录）。
  - AI 只填内容，页面与 layout 由模板决定。
- `critic.ts`：`critiqueDeck(spec, context)` 检查无证据结论、数字矛盾、风险遗漏、bullet 超长；输出 issues；Writer 最多修订 1 次。
- `render-pptx.ts`：`renderDeckPptx(deckId, spec)` 使用 `pptxgenjs` 生成 16:9 原生 PPTX，保存到 `public/dd-decks/<deckId>.pptx`，更新 `pptxUrl`。
- `queue.ts`：`enqueueDeck(deckId)`；生成 spec → 校验 → 渲染 PPTX → READY；失败 FAILED + error；超时恢复。

### 5.11 新增依赖

- `pptxgenjs`（原生 PPTX 生成）。不引入 zod（手写校验）、不引入 pg-boss。

## 6. API 路由

| 方法 | 路径 | 权限 | 行为 |
| --- | --- | --- | --- |
| POST | `/api/dd/research/[projectId]/run` | 编辑 | body `{ modules?, force? }`，创建/复用 run 并入队 |
| GET | `/api/dd/research/[projectId]/status` | 查看 | run 状态、phase、progress、模块覆盖 |
| GET | `/api/dd/research/[projectId]` | 查看 | 最近 run + 模块 + 来源 + 事实 |
| PATCH | `/api/dd/research/facts/[factId]` | 编辑 | `{ status: CONFIRMED/REJECTED }` |
| GET | `/api/dd/unclassified/[projectId]` | 查看 | 非分类资料列表 + OCR/归类状态 |
| POST | `/api/dd/unclassified/[projectId]` | 编辑 | formData `file`，快速入库 |
| PATCH | `/api/dd/unclassified/[projectId]/[assetId]` | 编辑 | `{ moduleKey }` 确认/修改归类 |
| DELETE | `/api/dd/unclassified/[projectId]/[assetId]` | 编辑 | 删除资料与引用 |
| POST | `/api/dd/unclassified/[projectId]/[assetId]/retry` | 编辑 | 重试 OCR |
| GET | `/api/dd/gaps/[projectId]` | 查看 | 缺口清单 + 汇总 |
| POST | `/api/dd/gaps/[projectId]/[gapId]/waive` | 合伙人/ADMIN | `{ reason }` 豁免 |
| GET/POST | `/api/dd/decks/[projectId]` | 查看/编辑 | GET 列表；POST `{ type }` 生成 |
| GET | `/api/dd/deck/[deckId]` | 查看 | deck + slides + spec |
| GET | `/api/dd/deck/[deckId]/pptx` | 查看 | 下载 PPTX |

Final 生成前置校验：全部 `BLOCKING` gap 为 `RESOLVED/WAIVED`；不满足返回 400 + 缺口清单。

## 7. 前端改动

### 7.1 `src/components/dd-workbench/DDWorkbenchShell.tsx`

- 新增状态：`researchRun`、`gapSummary`、`decks`、`activeDeck`、`showGapDrawer`、`resourceTab('modules'|'unclassified')`。
- 头部新增：
  - `DDResearchBar`：一键全网尽调 / 重跑、阶段进度、失败重试；不自动触发。
  - 「资料简报」「尽调报告」按钮；生成中禁用并显示进度。
  - 原「生成尽调报告」改名「生成九模块分析」，保留原逻辑。
- 头部下方新增缺口汇总条：「还需补充 N 项，其中 M 项阻塞」→ 打开 `DDGapDrawer`。
- 九宫格卡片增加徽章：网络事实数、上传资料数、缺口状态（红/黄/无）。
- 资料中心顶部增加分段控件「九大模块 / 非分类资料」；非分类页渲染 `DDUnclassifiedPanel`。
- 引入 `DDDeckViewer` 弹窗。

### 7.2 新增组件

- `DDResearchBar.tsx`：触发研究、轮询状态、显示 phase/progress/错误。
- `DDGapDrawer.tsx`：缺口列表、原因、缺失影响、可传类型、上传入口、豁免（仅合伙人/ADMIN）。
- `DDUnclassifiedPanel.tsx`：拖拽/多选上传、OCR 状态、归类建议、确认/移动到模块、删除、重试。
- `DDDeckViewer.tsx`：缩略图、翻页、全屏、下载 PPTX、导出 PNG/ZIP；复用年度报告导出实现。
- `DeckSlide.tsx`：固定 1280×720 版式渲染（cover/summary/section/module/matrix/risk/valuation/appendix/gap/compare），深海军蓝 + 青绿 + 金色 + 象牙白设计系统。

## 8. 权限与安全

- 查看：`canViewResearchProject`；编辑/触发/上传/生成：`canEditResearchProject`。
- 豁免：仅 `INVESTMENT_PARTNER` / `ADMIN`，必须填写理由。
- 上传资料只用于内部模型，不作为搜索 query；搜索只用公司名/行业/产品等公开实体。
- 文件保存在本机 `public/dd-unclassified`、`public/dd-decks`，与现有资料中心一致；下载走现有静态路径。
- 所有生成/豁免/导出写操作日志（console + 数据库状态字段），不新增审计表。

## 9. 成本与质量护栏

- 搜索 ≤45 次/项目；每查询 ≤5 条；每模块来源 ≤8 条；正文 ≤20k 字符。
- 抽取 9 次 LLM/项目；归类 1 次/资料；Deck 文案 1–2 次。
- 事实必须 `sourceId + quote` 才能进入结论；无来源事实不生成。
- 同一指标冲突 >20% 标 CONFLICT，报告只写「存在冲突」并列出两个来源。
- 版式校验不通过不写库；PPTX 渲染失败保留 spec，可重试。

## 10. 验证

1. 单元测试 `tests/dd-research.test.ts`：
   - `buildQueryPlan` 每模块 4–6 条、总数 ≤45、无重复。
   - `gradeSource` A/B/C/D 分类。
   - `computeModuleCoverage` READY/PARTIAL/INSUFFICIENT 边界。
   - `evaluateRequirementCoverage` 关键词命中/未命中。
   - `validateDeckSpec` 页数、标题、bullet、evidenceRefs 非法输入。
2. API 测试 `tests/dd-research-api.test.ts`（沿用现有测试 DB 模式）：
   - 未登录 401、非成员 403。
   - 创建 run 幂等、Final 阻塞缺口 400。
3. 全量命令：
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run build`
4. 浏览器手测：
   - 工作台一键研究 → 进度 → 九模块徽章变化。
   - 资料中心上传扫描 PDF → OCR 状态 → 归类 → 缺口关闭。
   - 生成 Brief → 查看 → PNG/ZIP + PPTX 下载。
   - 生成 Final（含缺口拦截与豁免）。

## 11. 不在本轮范围

- 自动投资决策、替代法务/财务正式尽调。
- 抓取登录后/付费墙内容。
- 服务端 PDF 导出（PPTX + PNG/ZIP 已覆盖）。
- pg-boss / 独立 Worker 进程。
- 对历史资料做批量迁移。

## 12. 批准

请批准本规格后开始按 `tasks.md` 执行。批准方式：回复「批准」或指出需要调整的条目。
