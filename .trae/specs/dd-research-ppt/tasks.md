# 尽调工作台 · 全网资料自动尽调与 PPT 报告 — 任务清单

对应规格：`spec.md`。执行顺序即依赖顺序。

## [x] 任务 1：数据模型与常量地基

文件：
- `prisma/schema.prisma`：新增 `DDResearchRun`、`DDModuleResearch`、`DDResearchSource`、`DDResearchFact`、`DDUnclassifiedAsset`、`DDGap`、`DDSlideDeck`、`DDSlide`；`Project` 增加 4 个关系字段。
- `src/lib/token-accounting.ts`：`TokenModule` 增加 `dd-research`、`dd-ingest`、`dd-deck`。
- `src/lib/tavily-search.ts`：`SearchModule` 增加 `dd-research`。
- `src/lib/dd-research/constants.ts`：九模块必备证据、搜索预算、来源分级、覆盖度状态。
- `package.json`：新增 `pptxgenjs`，版本升 `2.7.0`。

验收：
- `npx prisma generate` 成功；`npx prisma db push` 可执行（本地库）。
- `npx tsc --noEmit` 通过。

## [x] 任务 2：九模块研究引擎（纯函数 + DeepSeek）

文件：
- `src/lib/dd-research/planner.ts`
- `src/lib/dd-research/search.ts`
- `src/lib/dd-research/extract.ts`
- `src/lib/dd-research/coverage.ts`

要点：
- `buildQueryPlan` 每模块 4–6 条、总数 ≤45、去重。
- `searchModuleSources` 使用 `searchWebDual` collect 模式、12h 缓存、URL 去重、来源分级、正文截断 20k。
- `extractModuleFacts` 单模块一次调用，校验 sourceIdx/quote/confidence，冲突 >20% 标记。
- `computeModuleCoverage` 按 0.6/0.2/0.2 公式。

验收：
- 单元测试覆盖计划、分级、覆盖度边界、抽取结果清洗。

## [x] 任务 3：研究编排、队列与 API

文件：
- `src/lib/dd-research/gap.ts`
- `src/lib/dd-research/orchestrator.ts`
- `src/lib/dd-research/queue.ts`
- `src/app/api/dd/research/[projectId]/run/route.ts`
- `src/app/api/dd/research/[projectId]/status/route.ts`
- `src/app/api/dd/research/[projectId]/route.ts`
- `src/app/api/dd/research/facts/[factId]/route.ts`

要点：
- 24h 幂等、同项目仅 1 个 QUEUED/RUNNING、force 重跑。
- 阶段进度 PLAN/SEARCH/EXTRACT/SCORE/GAP，单模块失败继续。
- 保存 sources/facts/module research，重建 gaps。
- 权限：查看 vs 编辑。

验收：
- API 测试：401/403、幂等、状态查询、事实确认。
- 队列进程重启恢复逻辑与年度报告一致。

## [x] 任务 4：非分类资料、OCR 与归类

文件：
- `src/lib/dd-ingest/unclassified.ts`
- `src/lib/dd-ingest/ocr-queue.ts`
- `src/app/api/dd/unclassified/[projectId]/route.ts`
- `src/app/api/dd/unclassified/[projectId]/[assetId]/route.ts`
- `src/app/api/dd/unclassified/[projectId]/[assetId]/retry/route.ts`

要点：
- 快速入库 ≤3 秒；SHA-256 去重；`skipOcr` 快路径。
- 后台 OCR 并发 2；状态 PENDING/PROCESSING/READY/FAILED；支持重试。
- 归类置信度 ≥0.75 自动应用，0.5–0.75 建议，<0.5 未分类。
- 归类/移动/删除同步 `DDModuleResource.documents` 并刷新缺口。

验收：
- 上传扫描 PDF 返回 assetId；OCR 完成后可读；归类后模块文档出现；删除后引用消失。

## [x] 任务 5：缺口引擎与提醒

文件：
- `src/app/api/dd/gaps/[projectId]/route.ts`
- `src/app/api/dd/gaps/[projectId]/[gapId]/waive/route.ts`
- `src/components/dd-workbench/DDGapDrawer.tsx`

要点：
- BLOCKING/RECOMMENDED 生成规则；已覆盖自动 RESOLVED；WAIVED 不自动复活。
- 汇总 total/blocking/open；豁免仅合伙人/ADMIN，必须有理由。
- 抽屉展示缺什么、为什么、缺了会怎样、可传类型、上传入口。

验收：
- 上传覆盖资料后缺口自动关闭；未覆盖提示「已收到但未找到关键字段」。
- Final 生成被 BLOCKING 拦截，豁免后可生成。

## [x] 任务 6：研究/资料/缺口工作台 UI

文件：
- `src/components/dd-workbench/DDResearchBar.tsx`
- `src/components/dd-workbench/DDUnclassifiedPanel.tsx`
- `src/components/dd-workbench/DDWorkbenchShell.tsx`

要点：
- 头部按钮：一键全网尽调、资料简报、尽调报告；原按钮改名「生成九模块分析」。
- 进度条、phase、失败重试；不自动触发。
- 九宫格徽章：网络事实数、上传资料数、缺口状态。
- 资料中心分段控件与未分类面板。
- 缺口汇总条。

验收：
- 研究运行中页面可轮询进度；资料中心可切换分段；上传/归类/删除可操作。

## [x] 任务 7：SlideSpec 与 Brief 模板

文件：
- `src/lib/dd-deck/spec.ts`
- `src/lib/dd-deck/context.ts`
- `src/lib/dd-deck/writer.ts`
- `src/lib/dd-deck/critic.ts`
- `src/lib/dd-deck/queue.ts`
- `src/components/dd-workbench/DeckSlide.tsx`
- `src/components/dd-workbench/DDDeckViewer.tsx`
- `src/app/api/dd/decks/[projectId]/route.ts`
- `src/app/api/dd/deck/[deckId]/route.ts`

要点：
- 固定 14 页 Brief：封面、资料全景、结论摘要、九模块、缺口、下一步、来源附录。
- AI 只填标题/bullet/callout；模板控制 layout 与页数。
- 校验标题长度、bullet 数量、evidenceRefs 格式。
- 查看器：缩略图、翻页、全屏。

验收：
- Brief 12–15 页；每页有结论；缺口页完整；无溢出。

## [x] 任务 8：Final 模板与 Critique

文件：
- `src/lib/dd-deck/writer.ts`（Final 组装）
- `src/lib/dd-deck/critic.ts`
- `src/app/api/dd/decks/[projectId]/route.ts`（Final 前置校验）

要点：
- 固定 22 页：投资摘要、项目全景、为什么可能成 5 页、为什么可能不成 3 页、风险矩阵、机会矩阵、风险机会对照、估值、条款回报、结论条件、投后验证、证据索引、待验证附录。
- 风险与机会成对；无证据结论进「待验证」。
- Critic 检查无证据结论/数字矛盾/风险遗漏，最多修订 1 轮。
- BLOCKING 缺口未关闭/未豁免返回 400 + 清单。

验收：
- Final 22–26 页；关键结论 100% 有 E/F 引用；豁免项在风险页列明。

## [x] 任务 9：PNG/ZIP 与 PPTX 导出

文件：
- `src/lib/dd-deck/render-pptx.ts`
- `src/app/api/dd/deck/[deckId]/pptx/route.ts`
- `src/components/dd-workbench/DDDeckViewer.tsx`（PNG/ZIP）

要点：
- 浏览器端 `html-to-image` 渲染 1280×720 节点，pixelRatio 2，JSZip 打包。
- 服务端 `pptxgenjs` 生成 16:9 原生 PPTX，保存 `public/dd-decks/<deckId>.pptx`，下载走 API。
- 渲染失败保留 spec，可重试。

验收：
- PNG 每页清晰；ZIP 可解压；PPTX 可打开、文字可编辑。

## [x] 任务 10：测试、构建与版本

文件：
- `tests/dd-research.test.ts`
- `tests/dd-research-api.test.ts`
- `package.json`（版本 2.7.0）
- 部署说明（回复中给出，不新增文档文件）

执行：
1. `npx tsc --noEmit`
2. `npm test`
3. `npm run build`
4. 浏览器手测完整链路。

验收：
- 全量测试通过；构建通过；手测无阻塞问题。

## 明确的非目标

- 不自动随阶段触发研究。
- 不做服务端 PDF 导出。
- 不引入 Redis/pg-boss。
- 不迁移历史资料、不改现有九模块资料读取结构。
