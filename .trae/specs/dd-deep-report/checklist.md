# 深度尽调报告 — 验证清单

日期：2026-11-10
版本：2.8.0

## 代码与规格

- [x] `DeckType` 支持 `DEEP`，未改动 BRIEF/FINAL 的幻灯片类型
- [x] A4 文档规格包含封面、目录、章节页、正文、附录，页码连续
- [x] 装页预算生效：超长段落拆块、表格跨页分块、页尾不落单标题
- [x] 目录页码与章节页实际页码一致
- [x] 深度上下文加载 documents 全文、textBlocks、screenshots、人工结论、来源正文
- [x] 图表数据来自真实统计（覆盖度 9 项、等级分布合计等于事实数）
- [x] 九模块各生成 3–5 个核心问题、资料与发现、分析、结论
- [x] LLM 失败时按模块兜底，报告仍可生成
- [x] 图片管线：截图、PDF/PPTX 关键页、og:image，含 SSRF 私网拦截与数量上限
- [x] DEEP 指纹包含文档正文摘要与截图，资料变化触发新版本
- [x] DEEP 不生成 DDSlide、不渲染 PPTX；`slideCount` 记录真实页数
- [x] API POST 接受 DEEP，GET 返回 BRIEF/FINAL/DEEP 三套指纹
- [x] 前端新增「深度报告」入口，FINAL 显示名改为「汇报 PPT」
- [x] A4 预览含封面、目录、章节页、问答、表格、SVG 图表、图片与页码
- [x] 打印时仅输出报告文档，`window.print()` 导出 PDF
- [x] BRIEF/FINAL 的翻页、缩略图、PPTX/PNG 导出保持原样

## 自动化验证

- [x] `npx tsc --noEmit` 通过
- [x] `npm test` 全部通过（新增 6 条 DEEP 测试）
- [x] `npm run build` 通过
- [x] A4 文档 SSR 渲染快照：页数一致、含图表 SVG 与资料图片

## 环境限制

- [ ] 真实项目「生成深度报告 → 浏览器打印 PDF」需在部署环境由人工执行；本机验证覆盖了类型、单测、构建与 SSR 渲染，未调用真实 LLM 与项目数据。
