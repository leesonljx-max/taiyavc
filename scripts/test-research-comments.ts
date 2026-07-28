/**
 * 测试脚本：投研分析 - 模块收起展开 + 文档小窗预览 + 点评/回复功能
 *
 * 测试覆盖：
 * === 模块收起展开 ===
 * 1. 投研分析详情 API 返回 9 个模块
 * 2. 模块按 ALL_MODULE_TYPES 顺序排序
 * 3. 模块包含 analyzedAt 字段（用于"AI 已分析"标记）
 * 4. 模块包含 documents 字段（用于"X 个文档"标记）
 *
 * === 点评功能 ===
 * 5. 获取空点评列表返回空数组
 * 6. 发布点评成功（201）
 * 7. 发布空内容返回 400
 * 8. 发布超长内容（>2000 字）返回 400
 * 9. 未登录用户不能发布点评（401）
 * 10. 无权限用户不能发布点评（403）
 * 11. 获取点评列表返回已发布的点评
 * 12. 点评包含 user 信息（id, name, email）
 * 13. 点评包含 createdAt 时间戳
 * 14. 点评包含 replies 数组（初始为空）
 * 15. 多条点评按时间正序排列
 *
 * === 回复功能 ===
 * 16. 维护人回复点评成功（201）
 * 17. 回复包含 user 信息
 * 18. 回复包含 parentId
 * 19. 获取点评列表时回复嵌套在对应一级点评下
 * 20. 非维护人不能回复（403）
 * 21. 不能对回复再次回复（400）
 * 22. 回复空内容返回 400
 * 23. 回复不存在的点评返回 404
 * 24. 跨项目的点评回复返回 403
 *
 * === Prisma Schema 验证 ===
 * 25. ResearchComment 模型存在
 * 26. ResearchComment 有 moduleId/userId/parentId/content 字段
 * 27. ResearchComment 有 createdAt/updatedAt 字段
 * 28. ResearchModule 有 comments 反向关系
 * 29. User 有 researchComments 反向关系
 * 30. ResearchComment 有 @@index([moduleId])
 *
 * === API 路由源码验证 ===
 * 31. comments/route.ts 存在 GET 方法
 * 32. comments/route.ts 存在 POST 方法
 * 33. comments/[commentId]/replies/route.ts 存在 POST 方法
 * 34. comments API 校验 moduleType 合法性
 * 35. comments API 校验项目存在性
 * 36. replies API 校验父点评存在性
 * 37. replies API 校验父点评归属当前项目
 * 38. replies API 校验父点评是一级点评（parentId 为空）
 * 39. 点评 API 使用 canViewResearchProject 权限
 * 40. 回复 API 使用 canEditResearchProject 权限
 *
 * === 前端源码验证 ===
 * 41. 前端页面包含模块展开/收起按钮
 * 42. 前端模块默认收起（expanded 初始为 false）
 * 43. 前端展开后显示 AI 分析结果
 * 44. 前端展开后显示手动输入区域
 * 45. 前端展开后显示文档区域
 * 46. 前端文档点击触发预览模态框
 * 47. 前端使用 DocumentPreviewModal 组件
 * 48. 前端包含点评按钮
 * 49. 前端有点评面板（commentsOpen 状态）
 * 50. 前端点评面板包含输入框
 * 51. 前端点评列表显示发布人名字
 * 52. 前端点评列表显示点评内容
 * 53. 前端回复列表显示"维护人"标签
 * 54. 前端回复按钮仅对 canEdit 用户可见
 * 55. 前端收起时显示摘要预览
 * 56. 前端收起时显示文档数量标记
 */
import 'dotenv/config'

const BASE_URL = 'http://localhost:3000'

const ACCOUNTS = {
  admin: { email: 'taiyavc@example.com', password: 'taiya2506' },
  manager: { email: 'manager-test@example.com', password: 'manager123' },
  manager2: { email: 'manager-test2@example.com', password: 'manager456' },
}

interface TestResult {
  name: string
  passed: boolean
  detail?: string
}

const results: TestResult[] = []

function log(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  const status = passed ? '✓' : '✗'
  console.log(`${status} ${name}${detail && !passed ? ` — ${detail}` : ''}`)
}

async function login(email: string, password: string): Promise<string> {
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`)
  const csrfData = await csrfRes.json()
  const csrfToken = csrfData.csrfToken
  const cookie = csrfRes.headers.get('set-cookie') || ''
  const csrfMatch = cookie.match(/next-auth\.csrf-token=([^;]+)/)
  const csrfCookie = csrfMatch ? `next-auth.csrf-token=${csrfMatch[1]}` : ''

  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': csrfCookie,
    },
    body: new URLSearchParams({
      email,
      password,
      csrfToken,
      callbackUrl: `${BASE_URL}/`,
      json: 'true',
    }),
    redirect: 'manual',
  })
  const setCookie = loginRes.headers.get('set-cookie') || ''
  const match = setCookie.match(/next-auth\.session-token=([^;]+)/)
  if (!match) throw new Error(`登录失败: ${email}`)
  return `next-auth.session-token=${match[1]}`
}

async function apiCall(
  path: string,
  options: { method?: string; cookie?: string; body?: any } = {}
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function readFile(path: string): Promise<string> {
  const { readFile: fsReadFile } = await import('fs/promises')
  return fsReadFile(path, 'utf-8')
}

// ========== 测试开始 ==========
async function main() {
  console.log('\n========================================')
  console.log('  投研分析 - 模块收起 + 文档小窗 + 点评回复 测试')
  console.log('========================================\n')

  // ── 组1：登录 ──
  console.log('── 组1：登录 ──')
  let adminCookie = ''
  let managerCookie = ''
  let manager2Cookie = ''
  try {
    adminCookie = await login(ACCOUNTS.admin.email, ACCOUNTS.admin.password)
    log('管理员登录成功', !!adminCookie)
  } catch (e) {
    log('管理员登录成功', false, (e as Error).message)
  }
  try {
    managerCookie = await login(ACCOUNTS.manager.email, ACCOUNTS.manager.password)
    log('投资经理登录成功', !!managerCookie)
  } catch (e) {
    log('投资经理登录成功', false, (e as Error).message)
  }
  try {
    manager2Cookie = await login(ACCOUNTS.manager2.email, ACCOUNTS.manager2.password)
    log('投资经理2号登录成功', !!manager2Cookie)
  } catch (e) {
    log('投资经理2号登录成功', false, (e as Error).message)
  }

  if (!adminCookie || !managerCookie) {
    console.log('\n关键账号登录失败，终止测试。')
    return
  }

  // ── 组2：创建测试项目并设置为尽调阶段 ──
  console.log('\n── 组2：创建测试项目 ──')
  const testProjectName = `投研测试-${Date.now()}`
  const createRes = await apiCall('/api/projects', {
    method: 'POST',
    cookie: managerCookie,
    body: {
      name: testProjectName,
      industry: 'AI应用',
      companyPosition: '测试定位',
      investmentValuation: 5,
      totalAmount: '1000万',
      targetDate: new Date().toISOString(),
    },
  })
  const testProjectId = createRes.data.project?.id
  log('创建测试项目成功', !!testProjectId, `status=${createRes.status}`)

  if (!testProjectId) {
    console.log('\n项目创建失败，终止测试。')
    return
  }

  // 设置为尽调阶段使其出现在投研分析
  await apiCall(`/api/projects/${testProjectId}`, {
    method: 'PUT',
    cookie: managerCookie,
    body: { followStage: 'DUE_DILIGENCE' },
  })

  // ── 组3：投研分析详情 API ──
  console.log('\n── 组3：投研分析详情 API ──')
  const detailRes = await apiCall(`/api/research/${testProjectId}`, { cookie: managerCookie })
  log('投研分析详情返回 200', detailRes.status === 200, `status=${detailRes.status}`)
  log('返回 project 字段', !!detailRes.data.project)
  log('返回 modules 数组', Array.isArray(detailRes.data.modules))
  log('返回 9 个模块', detailRes.data.modules?.length === 9, `count=${detailRes.data.modules?.length}`)

  // 验证模块顺序
  const moduleTypes = detailRes.data.modules?.map((m: any) => m.moduleType) || []
  const expectedOrder = ['INDUSTRY', 'PRODUCT_TECH', 'COMPETITION', 'BUSINESS_DD', 'FINANCIAL_DD', 'TEAM', 'COMPANY', 'FINANCING', 'RECOMMENDATION']
  log('模块按 ALL_MODULE_TYPES 顺序排序', JSON.stringify(moduleTypes) === JSON.stringify(expectedOrder))

  // 验证模块字段
  const firstModule = detailRes.data.modules?.[0]
  log('模块包含 analyzedAt 字段', 'analyzedAt' in (firstModule || {}))
  log('模块包含 documents 字段', Array.isArray(firstModule?.documents))
  log('模块包含 aiJson 字段', 'aiJson' in (firstModule || {}))
  log('模块包含 aiSummary 字段', 'aiSummary' in (firstModule || {}))
  log('模块包含 content 字段', 'content' in (firstModule || {}))

  const testModuleType = 'INDUSTRY'
  const testModuleId = firstModule?.id

  // ── 组4：点评功能 ──
  console.log('\n── 组4：点评功能 ──')

  // 获取空点评列表
  const emptyCommentsRes = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments`, { cookie: managerCookie })
  log('获取空点评列表返回 200', emptyCommentsRes.status === 200)
  log('空点评列表为空数组', Array.isArray(emptyCommentsRes.data.comments) && emptyCommentsRes.data.comments.length === 0)

  // 未登录用户不能发布点评
  const unauthComment = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments`, {
    method: 'POST',
    body: { content: '测试未登录' },
  })
  log('未登录用户发布点评返回 401', unauthComment.status === 401, `status=${unauthComment.status}`)

  // 发布空内容点评
  const emptyContentRes = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments`, {
    method: 'POST',
    cookie: managerCookie,
    body: { content: '' },
  })
  log('发布空内容点评返回 400', emptyContentRes.status === 400, `status=${emptyContentRes.status}`)

  // 发布超长内容点评
  const longContent = 'x'.repeat(2001)
  const longContentRes = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments`, {
    method: 'POST',
    cookie: managerCookie,
    body: { content: longContent },
  })
  log('发布超长内容（>2000 字）返回 400', longContentRes.status === 400, `status=${longContentRes.status}`)

  // 发布有效点评
  const commentRes = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments`, {
    method: 'POST',
    cookie: managerCookie,
    body: { content: '这是一条测试点评内容' },
  })
  log('发布点评成功', commentRes.status === 201, `status=${commentRes.status}`)
  log('返回 comment 对象', !!commentRes.data.comment)
  log('点评包含 user 信息', !!commentRes.data.comment?.user)
  log('点评 user 包含 id', !!commentRes.data.comment?.user?.id)
  log('点评 user 包含 name', 'name' in (commentRes.data.comment?.user || {}))
  log('点评 user 包含 email', !!commentRes.data.comment?.user?.email)
  log('点评包含 createdAt', !!commentRes.data.comment?.createdAt)
  log('点评包含 replies 数组', Array.isArray(commentRes.data.comment?.replies))
  log('新点评 replies 为空', commentRes.data.comment?.replies?.length === 0)

  const commentId = commentRes.data.comment?.id

  // 发布第二条点评
  const comment2Res = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments`, {
    method: 'POST',
    cookie: managerCookie,
    body: { content: '这是第二条测试点评' },
  })
  log('发布第二条点评成功', comment2Res.status === 201)

  // 获取点评列表（应包含 2 条）
  const commentsListRes = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments`, { cookie: managerCookie })
  log('获取点评列表返回 200', commentsListRes.status === 200)
  log('点评列表包含 2 条点评', commentsListRes.data.comments?.length === 2, `count=${commentsListRes.data.comments?.length}`)
  log('点评按时间正序排列', commentsListRes.data.comments?.[0]?.createdAt <= commentsListRes.data.comments?.[1]?.createdAt)

  // ── 组5：无效模块类型 ──
  console.log('\n── 组5：无效模块类型 ──')
  const invalidModuleRes = await apiCall(`/api/research/${testProjectId}/INVALID_MODULE/comments`, { cookie: managerCookie })
  log('无效模块类型返回 400', invalidModuleRes.status === 400, `status=${invalidModuleRes.status}`)

  // ── 组6：回复功能 ──
  console.log('\n── 组6：回复功能 ──')

  // 回复空内容
  const emptyReplyRes = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments/${commentId}/replies`, {
    method: 'POST',
    cookie: managerCookie,
    body: { content: '' },
  })
  log('回复空内容返回 400', emptyReplyRes.status === 400, `status=${emptyReplyRes.status}`)

  // 回复不存在的点评
  const replyNotFoundRes = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments/nonexistent-id/replies`, {
    method: 'POST',
    cookie: managerCookie,
    body: { content: '测试回复' },
  })
  log('回复不存在的点评返回 404', replyNotFoundRes.status === 404, `status=${replyNotFoundRes.status}`)

  // 维护人回复点评
  const replyRes = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments/${commentId}/replies`, {
    method: 'POST',
    cookie: managerCookie,
    body: { content: '这是一条回复内容' },
  })
  log('维护人回复点评成功', replyRes.status === 201, `status=${replyRes.status}`)
  log('回复包含 user 信息', !!replyRes.data.reply?.user)
  log('回复包含 parentId', !!replyRes.data.reply?.parentId)
  log('回复 parentId 等于父点评 id', replyRes.data.reply?.parentId === commentId)
  log('回复包含 content', !!replyRes.data.reply?.content)
  log('回复包含 createdAt', !!replyRes.data.reply?.createdAt)

  // 验证回复嵌套在一级点评下
  const commentsWithReplies = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments`, { cookie: managerCookie })
  const parentComment = commentsWithReplies.data.comments?.find((c: any) => c.id === commentId)
  log('回复嵌套在对应一级点评下', parentComment?.replies?.length === 1, `replies=${parentComment?.replies?.length}`)
  log('回复内容正确', parentComment?.replies?.[0]?.content === '这是一条回复内容')

  // 不能对回复再次回复
  const replyId = replyRes.data.reply?.id
  const replyToReplyRes = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments/${replyId}/replies`, {
    method: 'POST',
    cookie: managerCookie,
    body: { content: '回复的回复' },
  })
  log('不能对回复再次回复（400）', replyToReplyRes.status === 400, `status=${replyToReplyRes.status}`)

  // ── 组7：权限校验 ──
  console.log('\n── 组7：权限校验 ──')

  if (manager2Cookie) {
    // manager2 不是该项目的维护人，不能回复
    const unauthorizedReplyRes = await apiCall(`/api/research/${testProjectId}/${testModuleType}/comments/${commentId}/replies`, {
      method: 'POST',
      cookie: manager2Cookie,
      body: { content: '无权回复' },
    })
    log('非维护人回复返回 403', unauthorizedReplyRes.status === 403, `status=${unauthorizedReplyRes.status}`)
  }

  // ── 组8：跨项目校验 ──
  console.log('\n── 组8：跨项目校验 ──')
  // 创建第二个项目，验证点评不能跨项目
  const project2Res = await apiCall('/api/projects', {
    method: 'POST',
    cookie: managerCookie,
    body: {
      name: `投研测试2-${Date.now()}`,
      industry: 'AI硬件',
      companyPosition: '测试定位2',
      investmentValuation: 3,
      totalAmount: '500万',
      targetDate: new Date().toISOString(),
    },
  })
  const project2Id = project2Res.data.project?.id
  if (project2Id) {
    // 将 commentId 作为 project2 的点评 ID 使用（应失败）
    const crossProjectRes = await apiCall(`/api/research/${project2Id}/${testModuleType}/comments/${commentId}/replies`, {
      method: 'POST',
      cookie: managerCookie,
      body: { content: '跨项目回复' },
    })
    log('跨项目回复返回 403', crossProjectRes.status === 403, `status=${crossProjectRes.status}`)

    // 清理项目2
    await apiCall(`/api/projects/${project2Id}`, { method: 'DELETE', cookie: adminCookie })
  }

  // ── 组9：Prisma Schema 验证 ──
  console.log('\n── 组9：Prisma Schema 验证 ──')
  const schemaSrc = await readFile('/Users/leeson/Desktop/投资管理系统/Investrask/I/prisma/schema.prisma')
  log('Schema 包含 ResearchComment 模型', schemaSrc.includes('model ResearchComment'))
  log('ResearchComment 有 moduleId 字段', schemaSrc.includes('moduleId') && schemaSrc.includes('model ResearchComment'))
  log('ResearchComment 有 userId 字段', /model ResearchComment[\s\S]*?userId/.test(schemaSrc))
  log('ResearchComment 有 parentId 字段', /model ResearchComment[\s\S]*?parentId/.test(schemaSrc))
  log('ResearchComment 有 content 字段', /model ResearchComment[\s\S]*?content\s+String/.test(schemaSrc))
  log('ResearchComment 有 createdAt 字段', /model ResearchComment[\s\S]*?createdAt/.test(schemaSrc))
  log('ResearchComment 有 updatedAt 字段', /model ResearchComment[\s\S]*?updatedAt/.test(schemaSrc))
  log('ResearchModule 有 comments 反向关系', /model ResearchModule[\s\S]*?comments\s+ResearchComment\[\]/.test(schemaSrc))
  log('User 有 researchComments 反向关系', schemaSrc.includes('researchComments   ResearchComment[]'))
  log('ResearchComment 有 @@index([moduleId])', /model ResearchComment[\s\S]*?@@index\(\[moduleId\]\)/.test(schemaSrc))
  log('ResearchComment 有自关联 parent/replies', schemaSrc.includes('ResearchCommentReplies'))

  // ── 组10：API 路由源码验证 ──
  console.log('\n── 组10：API 路由源码验证 ──')
  const commentsRouteSrc = await readFile('/Users/leeson/Desktop/投资管理系统/Investrask/I/src/app/api/research/[projectId]/[moduleType]/comments/route.ts')
  log('comments/route.ts 存在 GET 方法', commentsRouteSrc.includes('export async function GET'))
  log('comments/route.ts 存在 POST 方法', commentsRouteSrc.includes('export async function POST'))
  log('comments API 校验 moduleType', commentsRouteSrc.includes('isValidModuleType'))
  log('comments API 校验项目存在性', commentsRouteSrc.includes('项目不存在'))
  log('comments API 使用 canViewResearchProject', commentsRouteSrc.includes('canViewResearchProject'))
  log('comments API 校验空内容', commentsRouteSrc.includes('点评内容不能为空'))
  log('comments API 校验内容长度', commentsRouteSrc.includes('2000'))
  log('comments API 构建树形结构', commentsRouteSrc.includes('topLevel') || commentsRouteSrc.includes('repliesByParent'))

  const repliesRouteSrc = await readFile('/Users/leeson/Desktop/投资管理系统/Investrask/I/src/app/api/research/[projectId]/[moduleType]/comments/[commentId]/replies/route.ts')
  log('replies/route.ts 存在 POST 方法', repliesRouteSrc.includes('export async function POST'))
  log('replies API 校验父点评存在性', repliesRouteSrc.includes('父点评不存在'))
  log('replies API 校验父点评归属项目', repliesRouteSrc.includes('点评不属于该项目'))
  log('replies API 校验父点评归属模块', repliesRouteSrc.includes('点评不属于该模块'))
  log('replies API 校验一级点评', repliesRouteSrc.includes('parentId') && repliesRouteSrc.includes('不支持对回复再次回复'))
  log('replies API 使用 canEditResearchProject', repliesRouteSrc.includes('canEditResearchProject'))

  // ── 组11：前端源码验证 ──
  console.log('\n── 组11：前端源码验证 ──')
  const pageSrc = await readFile('/Users/leeson/Desktop/投资管理系统/Investrask/I/src/app/research/[projectId]/page.tsx')

  // 模块收起展开
  log('前端包含 expanded 状态', pageSrc.includes('const [expanded, setExpanded]'))
  log('前端模块默认收起', pageSrc.includes('useState(false)') && pageSrc.includes('expanded'))
  log('前端包含展开/收起按钮', pageSrc.includes('展开') && pageSrc.includes('收起'))
  log('前端收起时显示摘要预览', pageSrc.includes('summary') && pageSrc.includes('line-clamp-2'))
  log('前端收起时显示文档数量标记', pageSrc.includes('个文档'))
  log('前端收起时显示点评数量标记', pageSrc.includes('条点评'))
  log('前端展开后显示 AI 分析结果', pageSrc.includes('AI 分析结果'))
  log('前端展开后显示手动输入区域', pageSrc.includes('手动输入'))
  log('前端展开后显示文档区域', pageSrc.includes('补充文档'))

  // 文档小窗预览
  log('前端导入 DocumentPreviewModal', pageSrc.includes("import DocumentPreviewModal"))
  log('前端使用 DocumentPreviewModal 组件', pageSrc.includes('<DocumentPreviewModal'))
  log('前端包含 previewDoc 状态', pageSrc.includes('previewDoc'))
  log('前端文档点击触发预览', pageSrc.includes('setPreviewDoc'))
  log('前端包含预览按钮', pageSrc.includes('预览'))
  log('前端文档名可点击触发预览', pageSrc.includes('点击预览文档'))

  // 点评功能
  log('前端包含 commentsOpen 状态', pageSrc.includes('commentsOpen'))
  log('前端包含点评按钮', pageSrc.includes('点评'))
  log('前端有点评面板', pageSrc.includes('标注点评'))
  log('前端点评面板包含输入框', pageSrc.includes('对模块内容进行标注点评'))
  log('前端包含发布点评按钮', pageSrc.includes('发布点评'))
  log('前端点评列表显示发布人名字', pageSrc.includes('comment.user.name'))
  log('前端点评列表显示点评内容', pageSrc.includes('comment.content'))
  log('前端回复列表显示维护人标签', pageSrc.includes('维护人'))
  log('前端回复按钮仅对 canEdit 用户可见', pageSrc.includes('canEdit &&'))
  log('前端包含回复输入框', pageSrc.includes('回复'))
  log('前端包含 handleSubmitComment', pageSrc.includes('handleSubmitComment'))
  log('前端包含 handleSubmitReply', pageSrc.includes('handleSubmitReply'))
  log('前端包含 fetchComments', pageSrc.includes('fetchComments'))

  // ── 组12：清理测试数据 ──
  console.log('\n── 组12：清理测试数据 ──')
  const deleteRes = await apiCall(`/api/projects/${testProjectId}`, {
    method: 'DELETE',
    cookie: adminCookie,
  })
  log('清理测试项目成功', deleteRes.status === 200, `status=${deleteRes.status}`)

  // ── 汇总 ──
  console.log('\n========================================')
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`  测试完成：${passed} 通过，${failed} 失败，共 ${results.length} 项`)
  console.log('========================================\n')

  if (failed > 0) {
    console.log('失败项：')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    })
    process.exit(1)
  }
}

main().catch(err => {
  console.error('测试脚本异常：', err)
  process.exit(1)
})
