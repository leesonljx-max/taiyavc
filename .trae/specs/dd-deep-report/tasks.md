# 深度尽调报告（A4 图文文档版）— 任务清单

对应规格：`spec.md`。执行顺序即依赖顺序。

## [x] 任务 1：类型地基与页面组装

文件：
- `src/lib/dd-deck/spec.ts`：`DeckType` 增加 `'DEEP'`。
- 新增 `src/lib/dd-deep/spec.ts`：`DeepBlock`/`DeepPage`/`DeepDocSpec`；`assembleDeepDocSpec`、`coerceDeepDocSpec`、`estimatePageCount`、装页高度预算。

要点：
- 固定章节顺序：封面 → 目录 → 执行摘要 → 行业与时机 → 九大模块 → 风险估值结论 → 资料局限 → 附录。
- 目录页码在正文装页后回填。
- 标题不落单；超长段落拆页；页码连续。

验收：
- 单测：九模块齐全、页码连续、目录页码准确、页数 ≥25。

## [x] 任务 2：深度上下文与图表

文件：
- 新增 `src/lib/dd-deep/context.ts`：`buildDeepContext`、`DeepModuleContext`、`buildDeepCharts`。

要点：
- 复用 `buildDeckContext`。
- 加载 `DDModuleResource` 的 documents 全文（单篇 ≤4000 字、模块 ≤8000 字）、textBlocks、screenshots、conclusion、reportJson、verificationJson。
- 加载最新研究来源正文（每模块 4 条 × 1200 字）。
- 图表：覆盖度柱状、证据等级环形、三列对比表、财务数值表。

验收：
- 资料中心有文档时，上下文包含其正文；图表数量与事实统计一致。

## [x] 任务 3：模块写作与综述生成

文件：
- 新增 `src/lib/dd-deep/writer.ts`：`generateModuleContent`、`generateExecutiveSummary`、`generateOutlookAndRisks`、`fallbackModuleContent`。

要点：
- 每模块一次 `callDeepSeekJson`（`module:'dd-deck'`，`maxTokens:3200`，`timeoutMs:240000`）。
- 输出 3–5 个问题、4–6 条事实、4–6 条分析、结论、可选指标与局限。
- 强制 `[F#]`/`[E#]`/`[资料N]` 引用，禁止编造公司数字。
- LLM 失败时按人工结论 + 事实 + 缺口兜底，标记 `dataLimited`。

验收：
- 单测 mock LLM：正常 JSON 解析、非法 JSON 兜底、问题数不足时补齐。

## [x] 任务 4：图片管线

文件：
- 新增 `src/lib/dd-deep/images.ts`：`collectDeepImages`。

要点：
- 截图优先；文档按页提取（4 个模块、≤6 页）；网络 og:image ≤4 张。
- 文档路径 `public/research-docs/*`，过滤 >30MB，20s 超时。
- 网络图片：DNS 私网校验、5s 超时、≤2MB、仅 image/*、失败静默。
- 每张图带 caption 与 source；总数 ≤10。

验收：
- 单测：URL 白名单过滤、图片上限、来源缺失时丢弃。

## [x] 任务 5：生成流水线与队列

文件：
- 新增 `src/lib/dd-deep/pipeline.ts`：`generateDeepDeck`。
- `src/lib/dd-deck/queue.ts`：`createDeck` 类型扩展；`generateDeck` DEEP 分支。
- `src/lib/dd-research/fingerprint.ts`：DEEP 文档内容签名。

要点：
- 顺序：上下文 → 图片 → 9 模块串行写作（每模块心跳更新 `status`）→ 2 次综述 → 组装 → 写库。
- 不渲染 PPTX、不写 DDSlide；`slideCount` 存真实页数。
- 单模块失败兜底继续；整体失败写 FAILED。
- DEEP 指纹包含文档正文摘要与截图 ID。

验收：
- 生成后 `specJson` 为 `DeepDocSpec`、`slides` 为空、状态 READY。
- 资料变更后指纹变化；未变更复用。

## [x] 任务 6：API 支持

文件：
- `src/app/api/dd/decks/[projectId]/route.ts`。

要点：
- POST 接受 `DEEP`；DEEP 不检查 blocking gap。
- GET `current` 增加 `DEEP` 指纹。
- 错误文案区分三种报告。

验收：
- `POST {type:'DEEP'}` 返回 deckId；轮询详情返回文档 spec。

## [x] 任务 7：前端入口与 A4 预览

文件：
- `src/components/dd-workbench/DDResearchBar.tsx`。
- 新增 `src/components/dd-workbench/DeepReportDocument.tsx`。
- `src/components/dd-workbench/DDDeckViewer.tsx`。

要点：
- 按钮：资料简报 / 汇报 PPT / 深度报告；DEEP 使用主按钮样式。
- 版本摘要与指纹状态支持 DEEP。
- A4 渲染：封面、目录、章节页、正文、qa、表格、SVG 图表、图片、页脚页码。
- 打印 CSS 与 `window.print()`；DEEP 模式隐藏翻页/缩略图/PPTX/PNG 导出。

验收：
- 深度报告打开即 A4 纵向滚动预览；打印预览每页 A4、无空白页；BRIEF/FINAL 不受影响。

## [x] 任务 8：测试、版本与验证

文件：
- 新增 `tests/dd-deep.test.ts`。
- `package.json`：版本 `2.7.3`。

执行：
1. `npx tsc --noEmit`
2. `npm test`
3. `npm run build`
4. 浏览器手测：生成 → 预览 → 打印 PDF。

验收：
- 全部通过；报告含九模块问题/分析/结论、图表与图片；页数随内容变化。

## 明确的非目标

- 不做服务端 PDF 文件生成。
- 不为 DEEP 生成 PPTX。
- 不改 BRIEF/FINAL 版式与导出。
- 不对扫描件新增 OCR。
