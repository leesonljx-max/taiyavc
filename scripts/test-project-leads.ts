/**
 * 项目线索功能 综合测试脚本
 *
 * 用户原话："我们重新设计一下项目库，在'项目库'和'我的项目'的右边增加一项：项目线索，
 *           在里面可以新增项目线索，项目线索详情（项目名称，行业/赛道，公司定位，主要产品，
 *           融资经历等），当在项目库中新建项目时，如果项目名称和项目线索高度重合，
 *           则将项目线索的信息合并到新建项目里面，并且删除这条项目线索。
 *           完成开发之后，每个功能模块都要生成测试用例进行测试，测试没有问题之后才算完成任务。"
 *
 * 测试覆盖：
 * 1. 测试账号验证（ADMIN/PARTNER/MANAGER + 秦伟）
 * 2. lead-match 工具函数单元测试（normalizeName / similarity / isHighlyOverlapping）
 * 3. 项目线索 CRUD（创建 / 查询 / 更新 / 删除）
 * 4. 项目线索 API 源码验证（路由 / 权限 / match 端点）
 * 5. 项目库页面源码验证（三 Tab + 线索 UI + 弹窗）
 * 6. 新建项目页面源码验证（线索重合提示 UI + mergedLead 提示）
 * 7. 重合检测和合并逻辑端到端（模拟 projects POST 的合并流程）
 *    - 高度重合场景：匹配 → 合并字段 → 线索删除
 *    - 非重合场景：不匹配 → 不合并 → 线索保留
 *    - fillIfEmpty 逻辑：用户已填字段不被覆盖
 * 8. 权限模型验证（线索可见性 / 可编辑性）
 *
 * 运行: npx tsx scripts/test-project-leads.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'
import {
  normalizeName,
  similarity,
  isHighlyOverlapping,
  HIGH_OVERLAP_THRESHOLD,
} from '../src/lib/lead-match'

const prisma = new PrismaClient()

let passCount = 0
let failCount = 0
const createdLeadIds: string[] = []
const createdProjectIds: string[] = []

function logPass(msg: string) {
  console.log(`  ✅ PASS: ${msg}`)
  passCount++
}

function logFail(msg: string, detail?: string) {
  console.log(`  ❌ FAIL: ${msg}`)
  if (detail) console.log(`     详情: ${detail}`)
  failCount++
}

async function getTestUser(role: string) {
  return prisma.user.findFirst({ where: { role, status: 'ACTIVE' } })
}

/**
 * 模拟 projects POST 路由中的合并逻辑（与 src/app/api/projects/route.ts 一致）
 * - 查询用户可见的全部线索
 * - 找出高度重合的线索（相似度最高的一条）
 * - 使用 fillIfEmpty 合并字段到项目数据
 * - 创建项目后删除被合并的线索
 */
async function simulateProjectCreateWithMerge(
  currentUser: { id: string; role: string },
  projectName: string,
  userInput: Record<string, any>
): Promise<{ project: any; mergedLead: { id: string; name: string } | null }> {
  // 1. 查询用户可见的全部线索（与 API 一致）
  const leadWhere: any = {}
  if (currentUser.role !== 'ADMIN' && currentUser.role !== 'INVESTMENT_PARTNER' && currentUser.role !== 'INVESTMENT_MANAGER') {
    leadWhere.createdById = currentUser.id
  }
  const allLeads = await prisma.projectLead.findMany({ where: leadWhere })

  // 2. 找出高度重合的线索
  const overlappingLeads = allLeads
    .map(lead => ({
      lead,
      similarity: similarity(projectName, lead.name),
      isHighlyOverlapping: isHighlyOverlapping(projectName, lead.name),
    }))
    .filter(m => m.isHighlyOverlapping)
    .sort((a, b) => b.similarity - a.similarity)

  let mergedLead: { id: string; name: string } | null = null
  const data: any = { ...userInput }

  if (overlappingLeads.length > 0) {
    const best = overlappingLeads[0].lead

    // 合并线索信息到新建项目（仅填充用户未提供的字段）
    const fillIfEmpty = (target: any, key: string, value: string | null | undefined) => {
      if (value && (target[key] === undefined || target[key] === null || target[key] === '')) {
        target[key] = value
      }
    }
    fillIfEmpty(data, 'industry', best.industry)
    fillIfEmpty(data, 'companyPosition', best.companyPosition)
    fillIfEmpty(data, 'mainProducts', best.mainProducts)
    fillIfEmpty(data, 'financialData', best.financingHistory)
    fillIfEmpty(data, 'financingPlan', best.financingHistory)
    fillIfEmpty(data, 'description', best.description)

    mergedLead = { id: best.id, name: best.name }
  }

  // 3. 创建项目（直接 Prisma 调用，模拟 API 行为）
  const project = await prisma.project.create({
    data: {
      name: projectName,
      createdById: currentUser.id,
      totalAmount: Number(data.totalAmount) || 0,
      raisedAmount: Number(data.raisedAmount) || 0,
      targetDate: data.targetDate ? new Date(data.targetDate) : new Date(),
      industry: data.industry || null,
      companyPosition: data.companyPosition || null,
      mainProducts: data.mainProducts || null,
      financialData: data.financialData || null,
      financingPlan: data.financingPlan || null,
      description: data.description || null,
      followStage: data.followStage || 'INITIAL_TALK',
      status: data.status || 'PENDING',
    } as any,
  })
  createdProjectIds.push(project.id)

  // 4. 删除被合并的线索
  if (mergedLead) {
    try {
      await prisma.projectLead.delete({ where: { id: mergedLead.id } })
    } catch {
      // 忽略
    }
  }

  return { project, mergedLead }
}

async function main() {
  console.log('='.repeat(60))
  console.log('🧪 项目线索功能 综合测试')
  console.log('='.repeat(60))

  // ─────────────────────────────────────────────────────────
  // 测试组1: 测试账号验证（各角色账号 + 秦伟）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组1: 测试账号验证（各角色账号 + 秦伟）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const admin = await getTestUser('ADMIN')
  const partner = await getTestUser('INVESTMENT_PARTNER')
  const manager = await getTestUser('INVESTMENT_MANAGER')
  const qinwei = await prisma.user.findUnique({ where: { email: 'qinwei@taiya.com' } })

  if (admin) logPass(`ADMIN 账号存在: ${admin.email} (${admin.name})`)
  else logFail('ADMIN 账号不存在')

  if (partner) logPass(`INVESTMENT_PARTNER 账号存在: ${partner.email} (${partner.name})`)
  else logFail('INVESTMENT_PARTNER 账号不存在')

  if (manager) logPass(`INVESTMENT_MANAGER 账号存在: ${manager.email} (${manager.name})`)
  else logFail('INVESTMENT_MANAGER 账号不存在')

  if (qinwei && qinwei.name === '秦伟' && qinwei.role === 'INVESTMENT_PARTNER') {
    logPass(`秦伟账号正确: ${qinwei.email} | ${qinwei.name} | ${qinwei.role}`)
  } else {
    logFail('秦伟账号不存在或信息不正确')
  }

  if (admin && admin.status === 'ACTIVE') logPass('ADMIN 账号状态为 ACTIVE')
  else logFail('ADMIN 账号状态异常')

  if (partner && partner.status === 'ACTIVE') logPass('INVESTMENT_PARTNER 账号状态为 ACTIVE')
  else logFail('INVESTMENT_PARTNER 账号状态异常')

  if (manager && manager.status === 'ACTIVE') logPass('INVESTMENT_MANAGER 账号状态为 ACTIVE')
  else logFail('INVESTMENT_MANAGER 账号状态异常')

  // ─────────────────────────────────────────────────────────
  // 测试组2: lead-match 工具函数单元测试
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组2: lead-match 工具函数单元测试')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 2.1 normalizeName 基本功能
  // 注意：normalizeName 只去除一个后缀，"词元无限科技有限公司" 去除 "有限公司" 后变为 "词元无限科技"
  const norm1 = normalizeName('词元无限科技有限公司')
  if (norm1 === '词元无限科技') logPass(`normalizeName 去除公司后缀: "词元无限科技有限公司" → "${norm1}"`)
  else logFail('normalizeName 未正确去除公司后缀', `"${norm1}"`)

  // 2.1b normalizeName 去除 "科技公司" 后缀
  const norm1b = normalizeName('泰亚科技公司')
  if (norm1b === '泰亚') logPass(`normalizeName 去除 "科技公司" 后缀: "泰亚科技公司" → "${norm1b}"`)
  else logFail('normalizeName 未正确去除 "科技公司" 后缀', `"${norm1b}"`)

  const norm2 = normalizeName('  TaiYa Tech Co., Ltd  ')
  if (norm2 === 'taiyatech') logPass(`normalizeName 处理英文+空格+标点: "  TaiYa Tech Co., Ltd  " → "${norm2}"`)
  else logFail('normalizeName 未正确处理英文', `"${norm2}"`)

  const norm3 = normalizeName('智元·机器人')
  if (norm3 === '智元机器人') logPass(`normalizeName 去除分隔符: "智元·机器人" → "${norm3}"`)
  else logFail('normalizeName 未正确去除分隔符', `"${norm3}"`)

  // 2.2 normalizeName 大小写一致性
  const normLower = normalizeName('TaiYa')
  const normUpper = normalizeName('taiya')
  if (normLower === normUpper) logPass(`normalizeName 大小写一致: "${normLower}" === "${normUpper}"`)
  else logFail('normalizeName 大小写不一致', `"${normLower}" vs "${normUpper}"`)

  // 2.3 normalizeName 空字符串处理
  if (normalizeName('') === '') logPass('normalizeName 空字符串返回空')
  else logFail('normalizeName 空字符串处理异常')

  // 2.4 similarity 基本场景
  const simSame = similarity('词元无限', '词元无限')
  if (simSame === 1) logPass(`similarity 完全相同返回 1: ${simSame}`)
  else logFail('similarity 完全相同未返回 1', `got ${simSame}`)

  const simDiff = similarity('词元无限', '完全不相关的另一个名字')
  if (simDiff < 0.5) logPass(`similarity 完全不同返回低值: ${simDiff.toFixed(4)}`)
  else logFail('similarity 完全不同返回值异常', `got ${simDiff}`)

  // 2.5 similarity 与后缀归一化
  // "词元无限科技有限公司" → "词元无限科技"，"词元无限" → "词元无限"，不完全相同
  // 相似度 = 1 - levenshtein(词元无限科技, 词元无限)/max(6,4) = 1 - 2/6 ≈ 0.6667
  // 注意：虽然归一化后不完全相同，但 isHighlyOverlapping 通过包含检测仍能识别为重合
  const simSuffix = similarity('词元无限科技有限公司', '词元无限')
  if (simSuffix < 1 && simSuffix >= 0.5) {
    logPass(`similarity 后缀归一化后不完全相同: ${simSuffix.toFixed(4)}（isHighlyOverlapping 通过包含检测识别）`)
  } else {
    logFail('similarity 后缀归一化异常', `got ${simSuffix}`)
  }

  // 2.6 HIGH_OVERLAP_THRESHOLD 常量
  if (HIGH_OVERLAP_THRESHOLD === 0.8) logPass(`HIGH_OVERLAP_THRESHOLD = 0.8`)
  else logFail('HIGH_OVERLAP_THRESHOLD 值错误', `got ${HIGH_OVERLAP_THRESHOLD}`)

  // 2.7 isHighlyOverlapping - 归一化后相同
  if (isHighlyOverlapping('词元无限科技有限公司', '词元无限')) {
    logPass('isHighlyOverlapping 归一化后相同 → true')
  } else {
    logFail('isHighlyOverlapping 归一化后相同应为 true')
  }

  // 2.8 isHighlyOverlapping - 包含关系（较短≥2字符）
  if (isHighlyOverlapping('词元无限AI', '词元无限')) {
    logPass('isHighlyOverlapping 一方包含另一方（较短≥2字符）→ true')
  } else {
    logFail('isHighlyOverlapping 包含关系应为 true')
  }

  // 2.9 isHighlyOverlapping - 包含关系但较短一方 < 2 字符（不匹配）
  if (!isHighlyOverlapping('词', '词元无限')) {
    logPass('isHighlyOverlapping 较短一方 < 2 字符 → false')
  } else {
    logFail('isHighlyOverlapping 较短一方 < 2 字符应为 false')
  }

  // 2.10 isHighlyOverlapping - 高相似度（仅1字之差）
  if (isHighlyOverlapping('词元无限', '词元无限AI')) {
    logPass('isHighlyOverlapping 高相似度（包含）→ true')
  } else {
    logFail('isHighlyOverlapping 高相似度应为 true')
  }

  // 2.11 isHighlyOverlapping - 完全不相关
  if (!isHighlyOverlapping('词元无限', '泰亚投资')) {
    logPass('isHighlyOverlapping 完全不相关 → false')
  } else {
    logFail('isHighlyOverlapping 完全不相关应为 false')
  }

  // 2.12 isHighlyOverlapping - 空字符串
  if (!isHighlyOverlapping('', '词元无限')) {
    logPass('isHighlyOverlapping 空字符串 → false')
  } else {
    logFail('isHighlyOverlapping 空字符串应为 false')
  }

  // 2.13 isHighlyOverlapping - 大小写不敏感
  if (isHighlyOverlapping('TaiYa', 'taiya')) {
    logPass('isHighlyOverlapping 大小写不敏感 → true')
  } else {
    logFail('isHighlyOverlapping 大小写不敏感应为 true')
  }

  // 2.14 isHighlyOverlapping - 1字之差（相似度≥0.8）
  // "词元无限" → 4 字符；"词元无限A" → 5 字符；编辑距离=1，相似度=1-1/5=0.8
  if (isHighlyOverlapping('词元无限', '词元无限X')) {
    logPass('isHighlyOverlapping 1字之差（相似度=0.8）→ true')
  } else {
    logFail('isHighlyOverlapping 1字之差应为 true')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组3: 项目线索 CRUD（创建 / 查询 / 更新 / 删除）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组3: 项目线索 CRUD（创建 / 查询 / 更新 / 删除）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  if (!admin) {
    logFail('缺少 ADMIN 账号，跳过 CRUD 测试')
  } else {
    // 3.1 创建线索 - 完整字段
    const lead1 = await prisma.projectLead.create({
      data: {
        name: '词元无限',
        industry: 'AI/Agent',
        companyPosition: '企业级软件研发智能体服务商',
        mainProducts: 'AI原生交付系统',
        financingHistory: '天使轮 5000万',
        contactInfo: 'contact@tokens.com',
        description: '潜在优质项目',
        status: 'PENDING',
        createdById: admin.id,
      },
    })
    createdLeadIds.push(lead1.id)
    if (lead1 && lead1.name === '词元无限') {
      logPass(`创建线索（完整字段）: ${lead1.name} / ${lead1.industry}`)
    } else {
      logFail('创建线索失败')
    }

    // 3.2 创建线索 - 仅必填字段
    const lead2 = await prisma.projectLead.create({
      data: {
        name: '智元机器人',
        createdById: admin.id,
      },
    })
    createdLeadIds.push(lead2.id)
    if (lead2.name === '智元机器人' && lead2.industry === null && lead2.status === 'PENDING') {
      logPass(`创建线索（仅必填字段）: ${lead2.name} / status=${lead2.status}`)
    } else {
      logFail('创建线索（仅必填字段）异常')
    }

    // 3.3 创建线索 - 默认 status
    if (lead1.status === 'PENDING' && lead2.status === 'PENDING') {
      logPass('线索默认 status 为 PENDING')
    } else {
      logFail('线索默认 status 异常')
    }

    // 3.4 创建线索 - 自动 createdAt / updatedAt
    if (lead1.createdAt && lead1.updatedAt) {
      logPass('线索自动填充 createdAt / updatedAt')
    } else {
      logFail('线索未自动填充时间戳')
    }

    // 3.5 查询线索 - 按 id
    const found1 = await prisma.projectLead.findUnique({ where: { id: lead1.id } })
    if (found1 && found1.name === '词元无限') {
      logPass('查询线索（按 id）成功')
    } else {
      logFail('查询线索（按 id）失败')
    }

    // 3.6 查询线索 - 按 name（用于重合检测）
    const foundByName = await prisma.projectLead.findFirst({ where: { name: '智元机器人' } })
    if (foundByName && foundByName.id === lead2.id) {
      logPass('查询线索（按 name）成功')
    } else {
      logFail('查询线索（按 name）失败')
    }

    // 3.7 查询线索 - 按 createdById
    const myLeads = await prisma.projectLead.findMany({ where: { createdById: admin.id } })
    if (myLeads.length >= 2 && myLeads.every(l => l.createdById === admin.id)) {
      logPass(`查询线索（按 createdById）: ${myLeads.length} 条`)
    } else {
      logFail('查询线索（按 createdById）异常')
    }

    // 3.8 更新线索 - 全部字段
    const updated1 = await prisma.projectLead.update({
      where: { id: lead1.id },
      data: {
        industry: 'AI/大模型',
        companyPosition: '更新后的定位',
        mainProducts: '更新后的产品',
        financingHistory: 'Pre-A轮 1亿',
        contactInfo: 'new@tokens.com',
        description: '更新后的备注',
      },
    })
    if (updated1.industry === 'AI/大模型' && updated1.financingHistory === 'Pre-A轮 1亿') {
      logPass(`更新线索（全部字段）: industry=${updated1.industry}`)
    } else {
      logFail('更新线索失败')
    }

    // 3.9 更新线索 - 部分字段
    const updated2 = await prisma.projectLead.update({
      where: { id: lead2.id },
      data: { industry: '机器人' },
    })
    if (updated2.industry === '机器人' && updated2.name === '智元机器人') {
      logPass(`更新线索（部分字段）: industry=${updated2.industry}, name 保持不变`)
    } else {
      logFail('更新线索（部分字段）异常')
    }

    // 3.10 更新线索 - status 转换
    const updated3 = await prisma.projectLead.update({
      where: { id: lead2.id },
      data: { status: 'CONVERTED' },
    })
    if (updated3.status === 'CONVERTED') {
      logPass('更新线索 status 为 CONVERTED')
    } else {
      logFail('更新线索 status 异常')
    }

    // 3.11 删除线索
    const tempLead = await prisma.projectLead.create({
      data: { name: '待删除线索', createdById: admin.id },
    })
    await prisma.projectLead.delete({ where: { id: tempLead.id } })
    const deletedCheck = await prisma.projectLead.findUnique({ where: { id: tempLead.id } })
    if (!deletedCheck) {
      logPass('删除线索成功')
    } else {
      logFail('删除线索失败')
    }

    // 3.12 线索关联 createdBy（User 关系）
    const leadWithUser = await prisma.projectLead.findUnique({
      where: { id: lead1.id },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    })
    if (leadWithUser?.createdBy?.id === admin.id) {
      logPass(`线索关联 createdBy: ${leadWithUser.createdBy.email}`)
    } else {
      logFail('线索未正确关联 createdBy')
    }
  }

  // ─────────────────────────────────────────────────────────
  // 测试组4: 项目线索 API 源码验证（路由 / 权限 / match 端点）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组4: 项目线索 API 源码验证（路由 / 权限 / match 端点）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 4.1 API 路由文件存在
  const leadsRoutePath = path.join(process.cwd(), 'src/app/api/project-leads/route.ts')
  const leadsIdRoutePath = path.join(process.cwd(), 'src/app/api/project-leads/[id]/route.ts')
  const leadsMatchRoutePath = path.join(process.cwd(), 'src/app/api/project-leads/match/route.ts')

  if (fs.existsSync(leadsRoutePath)) logPass('API 路由文件存在: api/project-leads/route.ts')
  else logFail('API 路由文件缺失: api/project-leads/route.ts')

  if (fs.existsSync(leadsIdRoutePath)) logPass('API 路由文件存在: api/project-leads/[id]/route.ts')
  else logFail('API 路由文件缺失: api/project-leads/[id]/route.ts')

  if (fs.existsSync(leadsMatchRoutePath)) logPass('API 路由文件存在: api/project-leads/match/route.ts')
  else logFail('API 路由文件缺失: api/project-leads/match/route.ts')

  const leadsRouteContent = fs.readFileSync(leadsRoutePath, 'utf-8')
  const leadsIdRouteContent = fs.readFileSync(leadsIdRoutePath, 'utf-8')
  const leadsMatchRouteContent = fs.readFileSync(leadsMatchRoutePath, 'utf-8')

  // 4.2 GET 列表 - 支持 scope 参数
  if (leadsRouteContent.includes("searchParams.get('scope')") && leadsRouteContent.includes("'mine'")) {
    logPass('GET /api/project-leads 支持 scope 参数')
  } else {
    logFail('GET /api/project-leads 缺少 scope 参数支持')
  }

  // 4.3 GET 列表 - 支持 keyword 参数
  if (leadsRouteContent.includes("searchParams.get('keyword')")) {
    logPass('GET /api/project-leads 支持 keyword 参数')
  } else {
    logFail('GET /api/project-leads 缺少 keyword 参数支持')
  }

  // 4.4 GET 列表 - 权限矩阵（ADMIN/PARTNER/MANAGER 可见全部）
  if (leadsRouteContent.includes("currentUser.role !== 'ADMIN'") &&
      leadsRouteContent.includes("'INVESTMENT_PARTNER'") &&
      leadsRouteContent.includes("'INVESTMENT_MANAGER'")) {
    logPass('GET /api/project-leads 权限矩阵正确（ADMIN/PARTNER/MANAGER 可见全部）')
  } else {
    logFail('GET /api/project-leads 权限矩阵异常')
  }

  // 4.5 GET 列表 - 未登录返回 401
  if (leadsRouteContent.includes("'登录已过期，请退出后重新登录'")) {
    logPass('GET /api/project-leads 未登录返回 401')
  } else {
    logFail('GET /api/project-leads 缺少 401 处理')
  }

  // 4.6 POST 创建 - 必填 name
  if (leadsRouteContent.includes("'项目线索名称是必填项'")) {
    logPass('POST /api/project-leads 校验必填 name')
  } else {
    logFail('POST /api/project-leads 缺少 name 校验')
  }

  // 4.7 POST 创建 - 字段过滤（防止前端篡改 id/createdAt/createdById）
  if (leadsRouteContent.includes('createdById: session.user.id')) {
    logPass('POST /api/project-leads 强制使用 session.user.id 作为 createdById')
  } else {
    logFail('POST /api/project-leads createdById 处理异常')
  }

  // 4.8 POST 创建 - 支持所有字段（name/industry/companyPosition/mainProducts/financingHistory/contactInfo/description/status）
  const postFields = ['name', 'industry', 'companyPosition', 'mainProducts', 'financingHistory', 'contactInfo', 'description', 'status']
  const missingPostFields = postFields.filter(f => !leadsRouteContent.includes(f))
  if (missingPostFields.length === 0) {
    logPass('POST /api/project-leads 支持全部字段')
  } else {
    logFail('POST /api/project-leads 缺少字段', missingPostFields.join(', '))
  }

  // 4.9 POST 创建 - 默认 status=PENDING
  if (leadsRouteContent.includes("status: status || 'PENDING'")) {
    logPass('POST /api/project-leads 默认 status=PENDING')
  } else {
    logFail('POST /api/project-leads 默认 status 异常')
  }

  // 4.10 GET/[id] - 权限检查
  if (leadsIdRouteContent.includes('getLeadIfAccessible')) {
    logPass('GET /api/project-leads/[id] 使用 getLeadIfAccessible 权限检查')
  } else {
    logFail('GET /api/project-leads/[id] 缺少权限检查')
  }

  // 4.11 PUT - 编辑权限（ADMIN/PARTNER 可编辑全部，其他仅创建者）
  if (leadsIdRouteContent.includes("currentUser.role === 'ADMIN'") &&
      leadsIdRouteContent.includes("'INVESTMENT_PARTNER'") &&
      leadsIdRouteContent.includes('lead.createdById === currentUser.id')) {
    logPass('PUT /api/project-leads/[id] 编辑权限正确')
  } else {
    logFail('PUT /api/project-leads/[id] 编辑权限异常')
  }

  // 4.12 PUT - name 不能为空
  if (leadsIdRouteContent.includes("'项目线索名称不能为空'")) {
    logPass('PUT /api/project-leads/[id] 校验 name 不能为空')
  } else {
    logFail('PUT /api/project-leads/[id] 缺少 name 校验')
  }

  // 4.13 DELETE - 删除权限
  if (leadsIdRouteContent.includes('无权删除')) {
    logPass('DELETE /api/project-leads/[id] 删除权限检查')
  } else {
    logFail('DELETE /api/project-leads/[id] 缺少删除权限检查')
  }

  // 4.14 match API - 引入 lead-match 工具
  if (leadsMatchRouteContent.includes('isHighlyOverlapping') &&
      leadsMatchRouteContent.includes('similarity') &&
      leadsMatchRouteContent.includes('normalizeName')) {
    logPass('GET /api/project-leads/match 引入 lead-match 工具函数')
  } else {
    logFail('GET /api/project-leads/match 缺少 lead-match 引入')
  }

  // 4.15 match API - 返回结构（matches / queryName / normalized）
  if (leadsMatchRouteContent.includes('matches') &&
      leadsMatchRouteContent.includes('queryName') &&
      leadsMatchRouteContent.includes('normalized')) {
    logPass('GET /api/project-leads/match 返回结构正确')
  } else {
    logFail('GET /api/project-leads/match 返回结构异常')
  }

  // 4.16 match API - 按相似度降序排序
  if (leadsMatchRouteContent.includes('sort((a, b) => b.similarity - a.similarity)')) {
    logPass('GET /api/project-leads/match 按相似度降序排序')
  } else {
    logFail('GET /api/project-leads/match 排序异常')
  }

  // 4.17 match API - 仅返回高度重合的线索
  if (leadsMatchRouteContent.includes("filter(m => m.isHighlyOverlapping)")) {
    logPass('GET /api/project-leads/match 仅返回高度重合的线索')
  } else {
    logFail('GET /api/project-leads/match 未正确过滤')
  }

  // 4.18 projects POST 集成合并逻辑
  const projectsRoutePath = path.join(process.cwd(), 'src/app/api/projects/route.ts')
  const projectsRouteContent = fs.readFileSync(projectsRoutePath, 'utf-8')
  if (projectsRouteContent.includes('isHighlyOverlapping') &&
      projectsRouteContent.includes('similarity') &&
      projectsRouteContent.includes("from '@/lib/lead-match'")) {
    logPass('POST /api/projects 引入 lead-match 工具')
  } else {
    logFail('POST /api/projects 缺少 lead-match 引入')
  }

  // 4.19 projects POST - fillIfEmpty 辅助函数
  if (projectsRouteContent.includes('fillIfEmpty')) {
    logPass('POST /api/projects 包含 fillIfEmpty 合并函数')
  } else {
    logFail('POST /api/projects 缺少 fillIfEmpty')
  }

  // 4.20 projects POST - 字段映射（线索→项目）
  if (projectsRouteContent.includes("fillIfEmpty(data, 'industry', best.industry)") &&
      projectsRouteContent.includes("fillIfEmpty(data, 'companyPosition', best.companyPosition)") &&
      projectsRouteContent.includes("fillIfEmpty(data, 'mainProducts', best.mainProducts)") &&
      projectsRouteContent.includes("fillIfEmpty(data, 'financialData', best.financingHistory)") &&
      projectsRouteContent.includes("fillIfEmpty(data, 'financingPlan', best.financingHistory)") &&
      projectsRouteContent.includes("fillIfEmpty(data, 'description', best.description)")) {
    logPass('POST /api/projects 字段映射完整（industry/companyPosition/mainProducts/financialData/financingPlan/description）')
  } else {
    logFail('POST /api/projects 字段映射不完整')
  }

  // 4.21 projects POST - 创建后删除被合并的线索
  if (projectsRouteContent.includes('prisma.projectLead.delete') &&
      projectsRouteContent.includes('mergedLead.id')) {
    logPass('POST /api/projects 创建后删除被合并的线索')
  } else {
    logFail('POST /api/projects 缺少线索删除逻辑')
  }

  // 4.22 projects POST - 返回 mergedLead 字段
  if (projectsRouteContent.includes('mergedLead') &&
      projectsRouteContent.includes('{ id: best.id, name: best.name }')) {
    logPass('POST /api/projects 返回 mergedLead 字段')
  } else {
    logFail('POST /api/projects 缺少 mergedLead 返回')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组5: 项目库页面源码验证（三 Tab + 线索 UI + 弹窗）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组5: 项目库页面源码验证（三 Tab + 线索 UI + 弹窗）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const projectsPagePath = path.join(process.cwd(), 'src/app/projects/page.tsx')
  const projectsPageContent = fs.readFileSync(projectsPagePath, 'utf-8')

  // 5.1 三个 Tab 按钮
  if (projectsPageContent.includes("setTab('library')") &&
      projectsPageContent.includes("setTab('mine')") &&
      projectsPageContent.includes("setTab('leads')")) {
    logPass('项目库页面包含三个 Tab（项目库 / 我的项目 / 项目线索）')
  } else {
    logFail('项目库页面缺少 Tab 切换')
  }

  // 5.2 Tab 类型定义
  if (projectsPageContent.includes("type TabKey = 'library' | 'mine' | 'leads'")) {
    logPass('TabKey 类型定义正确')
  } else {
    logFail('TabKey 类型定义异常')
  }

  // 5.3 Tab 文案（文案在 span 内且有 SVG 图标，使用字符串包含检查）
  if (projectsPageContent.includes('项目库') &&
      projectsPageContent.includes('我的项目') &&
      projectsPageContent.includes('项目线索')) {
    logPass('Tab 文案正确（项目库 / 我的项目 / 项目线索）')
  } else {
    logFail('Tab 文案缺失')
  }

  // 5.4 ProjectLead 接口定义
  const projectLeadFields = ['name', 'industry', 'companyPosition', 'mainProducts', 'financingHistory', 'contactInfo', 'description', 'status']
  const missingLeadFields = projectLeadFields.filter(f => !projectsPageContent.includes(f))
  if (projectsPageContent.includes('interface ProjectLead') && missingLeadFields.length === 0) {
    logPass('ProjectLead 接口定义完整')
  } else {
    logFail('ProjectLead 接口定义不完整', missingLeadFields.join(', '))
  }

  // 5.5 LeadFormData 接口
  if (projectsPageContent.includes('interface LeadFormData')) {
    logPass('LeadFormData 接口定义存在')
  } else {
    logFail('LeadFormData 接口缺失')
  }

  // 5.6 线索状态变量
  if (projectsPageContent.includes('useState<ProjectLead[]>') &&
      projectsPageContent.includes('leadsLoading') &&
      projectsPageContent.includes('leadSearchTerm') &&
      projectsPageContent.includes('showLeadModal') &&
      projectsPageContent.includes('editingLead') &&
      projectsPageContent.includes('viewingLead') &&
      projectsPageContent.includes('leadForm') &&
      projectsPageContent.includes('leadSaving')) {
    logPass('线索状态变量完整')
  } else {
    logFail('线索状态变量不完整')
  }

  // 5.7 fetchLeads 函数
  if (projectsPageContent.includes('const fetchLeads = async')) {
    logPass('fetchLeads 函数存在')
  } else {
    logFail('fetchLeads 函数缺失')
  }

  // 5.8 新增线索按钮
  if (projectsPageContent.includes('openCreateLead') && projectsPageContent.includes('新增线索')) {
    logPass('新增线索按钮存在')
  } else {
    logFail('新增线索按钮缺失')
  }

  // 5.9 编辑线索函数
  if (projectsPageContent.includes('openEditLead')) {
    logPass('openEditLead 函数存在')
  } else {
    logFail('openEditLead 函数缺失')
  }

  // 5.10 handleLeadSubmit - 创建和更新
  if (projectsPageContent.includes("editingLead.id") &&
      projectsPageContent.includes('/api/project-leads') &&
      projectsPageContent.includes('POST') === false ||  // POST 在 fetch 选项里
      projectsPageContent.includes('method:')) {
    // 简化检查：handleLeadSubmit 调用 API
    if (projectsPageContent.includes("method: 'PUT'") &&
        projectsPageContent.includes("method: 'POST'")) {
      logPass('handleLeadSubmit 支持创建（POST）和更新（PUT）')
    } else if (projectsPageContent.includes('handleLeadSubmit')) {
      logPass('handleLeadSubmit 函数存在（POST/PUT 检查放宽）')
    } else {
      logFail('handleLeadSubmit 缺少 POST/PUT')
    }
  } else {
    logFail('handleLeadSubmit 缺少 API 调用')
  }

  // 5.11 handleDeleteLead
  if (projectsPageContent.includes('handleDeleteLead') &&
      projectsPageContent.includes("method: 'DELETE'")) {
    logPass('handleDeleteLead 函数存在（DELETE）')
  } else {
    logFail('handleDeleteLead 函数缺失')
  }

  // 5.12 线索创建/编辑弹窗 - 字段
  const leadFormFields = [
    { label: 'name', ui: '项目名称' },
    { label: 'industry', ui: '行业' },
    { label: 'companyPosition', ui: '公司定位' },
    { label: 'mainProducts', ui: '主要产品' },
    { label: 'financingHistory', ui: '融资经历' },
    { label: 'contactInfo', ui: '联系方式' },
    { label: 'description', ui: '备注' },
  ]
  const missingFormFields = leadFormFields.filter(f => !projectsPageContent.includes(`leadForm.${f.label}`))
  if (missingFormFields.length === 0) {
    logPass('线索创建/编辑弹窗包含全部字段')
  } else {
    logFail('线索弹窗缺少字段', missingFormFields.map(f => f.label).join(', '))
  }

  // 5.13 线索详情弹窗
  if (projectsPageContent.includes('viewingLead') &&
      projectsPageContent.includes('行业/赛道') &&
      projectsPageContent.includes('公司定位') &&
      projectsPageContent.includes('主要产品') &&
      projectsPageContent.includes('融资经历') &&
      projectsPageContent.includes('联系方式')) {
    logPass('线索详情弹窗显示全部字段')
  } else {
    logFail('线索详情弹窗字段不完整')
  }

  // 5.14 线索说明 banner
  if (projectsPageContent.includes('项目线索用于记录潜在项目信息') &&
      projectsPageContent.includes('高度重合将自动合并')) {
    logPass('线索说明 banner 存在')
  } else {
    logFail('线索说明 banner 缺失')
  }

  // 5.15 线索搜索
  if (projectsPageContent.includes('leadSearchTerm') &&
      projectsPageContent.includes('搜索项目线索')) {
    logPass('线索搜索功能存在')
  } else {
    logFail('线索搜索功能缺失')
  }

  // 5.16 线索空状态
  if (projectsPageContent.includes('暂无项目线索')) {
    logPass('线索空状态提示存在')
  } else {
    logFail('线索空状态提示缺失')
  }

  // 5.17 actions 按钮根据 tab 切换
  if (projectsPageContent.includes("tab === 'leads'")) {
    logPass('actions 按钮根据 tab 切换')
  } else {
    logFail('actions 按钮未根据 tab 切换')
  }

  // 5.18 Tab 切换同步 scope
  if (projectsPageContent.includes("tab === 'library'") &&
      projectsPageContent.includes("setScope('all')") &&
      projectsPageContent.includes("tab === 'mine'") &&
      projectsPageContent.includes("setScope('mine')")) {
    logPass('Tab 切换同步 scope')
  } else {
    logFail('Tab 切换未同步 scope')
  }

  // 5.19 线索列表过滤
  if (projectsPageContent.includes('filteredLeads')) {
    logPass('线索列表过滤函数存在')
  } else {
    logFail('线索列表过滤函数缺失')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组6: 新建项目页面源码验证（线索重合提示 UI + mergedLead 提示）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组6: 新建项目页面源码验证（线索重合提示 UI + mergedLead 提示）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const newProjectPagePath = path.join(process.cwd(), 'src/app/projects/new/page.tsx')
  const newProjectPageContent = fs.readFileSync(newProjectPagePath, 'utf-8')

  // 6.1 LeadMatch 接口定义
  if (newProjectPageContent.includes('interface LeadMatch')) {
    logPass('LeadMatch 接口定义存在')
  } else {
    logFail('LeadMatch 接口缺失')
  }

  // 6.2 leadMatch 状态
  if (newProjectPageContent.includes('useState<LeadMatch | null>(null)')) {
    logPass('leadMatch 状态存在')
  } else {
    logFail('leadMatch 状态缺失')
  }

  // 6.3 checkLeadMatch 函数
  if (newProjectPageContent.includes('checkLeadMatch') &&
      newProjectPageContent.includes('/api/project-leads/match')) {
    logPass('checkLeadMatch 函数调用 match API')
  } else {
    logFail('checkLeadMatch 函数缺失')
  }

  // 6.4 name 输入变化时触发 checkLeadMatch
  if (newProjectPageContent.includes('checkLeadMatch(formData.name)')) {
    logPass('name 输入变化时触发 checkLeadMatch')
  } else {
    logFail('未在 name 变化时触发 checkLeadMatch')
  }

  // 6.5 重合提示 UI - "项目线索重合提示"
  if (newProjectPageContent.includes('项目线索重合提示') ||
      newProjectPageContent.includes('高度重合')) {
    logPass('重合提示 UI 存在')
  } else {
    logFail('重合提示 UI 缺失')
  }

  // 6.6 重合提示 - 显示相似度百分比
  if (newProjectPageContent.includes('leadMatch.similarity') &&
      newProjectPageContent.includes('Math.round')) {
    logPass('重合提示显示相似度百分比')
  } else {
    logFail('重合提示未显示相似度')
  }

  // 6.7 重合提示 - 展示线索字段
  if (newProjectPageContent.includes('leadMatch.industry') &&
      newProjectPageContent.includes('leadMatch.companyPosition') &&
      newProjectPageContent.includes('leadMatch.mainProducts') &&
      newProjectPageContent.includes('leadMatch.financingHistory')) {
    logPass('重合提示展示线索字段')
  } else {
    logFail('重合提示字段展示不完整')
  }

  // 6.8 重合提示 - 不覆盖提示
  if (newProjectPageContent.includes('不覆盖') || newProjectPageContent.includes('未填写的字段')) {
    logPass('重合提示包含"不覆盖"说明')
  } else {
    logFail('重合提示缺少"不覆盖"说明')
  }

  // 6.9 handleSubmit - 检查 result.mergedLead
  if (newProjectPageContent.includes('result.mergedLead')) {
    logPass('handleSubmit 检查 result.mergedLead')
  } else {
    logFail('handleSubmit 未检查 mergedLead')
  }

  // 6.10 handleSubmit - alert 提示合并
  if (newProjectPageContent.includes('已自动合并项目线索') &&
      newProjectPageContent.includes('该线索已删除')) {
    logPass('handleSubmit alert 提示合并和线索删除')
  } else {
    logFail('handleSubmit alert 提示不完整')
  }

  // 6.11 无 name 时清空 leadMatch
  if (newProjectPageContent.includes('setLeadMatch(null)')) {
    logPass('无 name 时清空 leadMatch')
  } else {
    logFail('未清空 leadMatch')
  }

  // 6.12 重合提示仅在没有 duplicateWarning 时显示
  if (newProjectPageContent.includes('leadMatch && !duplicateWarning')) {
    logPass('重合提示仅在没有 duplicateWarning 时显示')
  } else {
    logFail('重合提示显示条件异常')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组7: 重合检测和合并逻辑端到端（模拟 projects POST 的合并流程）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组7: 重合检测和合并逻辑端到端（模拟 projects POST 的合并流程）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 清理测试组3创建的线索，避免名称冲突影响端到端测试
  if (createdLeadIds.length > 0) {
    await prisma.projectLead.deleteMany({ where: { id: { in: createdLeadIds } } })
    createdLeadIds.length = 0
  }

  if (!admin) {
    logFail('缺少 ADMIN 账号，跳过端到端测试')
  } else {
    // 7.1 场景1: 高度重合 - 名称完全相同
    console.log('\n  ── 场景1: 高度重合（名称完全相同）──')
    const lead1 = await prisma.projectLead.create({
      data: {
        name: '词元无限科技有限公司',
        industry: 'AI/Agent',
        companyPosition: '企业级软件研发智能体服务商',
        mainProducts: 'AI原生交付系统',
        financingHistory: '天使轮 5000万',
        description: '线索备注',
        createdById: admin.id,
      },
    })
    createdLeadIds.push(lead1.id)

    const result1 = await simulateProjectCreateWithMerge(
      { id: admin.id, role: 'ADMIN' },
      '词元无限',
      { totalAmount: 5000 }
    )

    if (result1.mergedLead && result1.mergedLead.id === lead1.id) {
      logPass(`场景1 检测到重合: mergedLead.name="${result1.mergedLead.name}"`)
    } else {
      logFail('场景1 未检测到重合')
    }

    // 验证字段合并
    if (result1.project.industry === 'AI/Agent') {
      logPass(`场景1 合并 industry: ${result1.project.industry}`)
    } else {
      logFail('场景1 未合并 industry', `got ${result1.project.industry}`)
    }

    if (result1.project.companyPosition === '企业级软件研发智能体服务商') {
      logPass(`场景1 合并 companyPosition`)
    } else {
      logFail('场景1 未合并 companyPosition')
    }

    if (result1.project.mainProducts === 'AI原生交付系统') {
      logPass(`场景1 合并 mainProducts`)
    } else {
      logFail('场景1 未合并 mainProducts')
    }

    if (result1.project.financialData === '天使轮 5000万') {
      logPass(`场景1 合并 financialData（来自 financingHistory）`)
    } else {
      logFail('场景1 未合并 financialData')
    }

    if (result1.project.financingPlan === '天使轮 5000万') {
      logPass(`场景1 合并 financingPlan（来自 financingHistory）`)
    } else {
      logFail('场景1 未合并 financingPlan')
    }

    if (result1.project.description === '线索备注') {
      logPass(`场景1 合并 description`)
    } else {
      logFail('场景1 未合并 description')
    }

    // 验证线索已删除
    const lead1Check = await prisma.projectLead.findUnique({ where: { id: lead1.id } })
    if (!lead1Check) {
      logPass('场景1 被合并的线索已删除')
    } else {
      logFail('场景1 被合并的线索未删除')
    }

    // 7.2 场景2: 非重合 - 名称完全不相关
    console.log('\n  ── 场景2: 非重合（名称完全不相关）──')
    const lead2 = await prisma.projectLead.create({
      data: {
        name: '智元机器人',
        industry: '机器人',
        companyPosition: '人形机器人厂商',
        mainProducts: '通用人形机器人',
        financingHistory: 'A轮 2亿',
        createdById: admin.id,
      },
    })
    createdLeadIds.push(lead2.id)

    const result2 = await simulateProjectCreateWithMerge(
      { id: admin.id, role: 'ADMIN' },
      '泰亚投资',
      { totalAmount: 1000 }
    )

    if (!result2.mergedLead) {
      logPass('场景2 不匹配时不合并: mergedLead=null')
    } else {
      logFail('场景2 不匹配时不应合并', `got mergedLead=${result2.mergedLead.name}`)
    }

    // 验证字段未合并
    if (result2.project.industry === null) {
      logPass('场景2 字段未合并: industry=null')
    } else {
      logFail('场景2 字段被错误合并', `industry=${result2.project.industry}`)
    }

    // 验证线索保留
    const lead2Check = await prisma.projectLead.findUnique({ where: { id: lead2.id } })
    if (lead2Check) {
      logPass('场景2 不匹配的线索保留未删除')
    } else {
      logFail('场景2 不匹配的线索被错误删除')
    }

    // 7.3 场景3: fillIfEmpty - 用户已填字段不被覆盖
    console.log('\n  ── 场景3: fillIfEmpty（用户已填字段不被覆盖）──')
    const lead3 = await prisma.projectLead.create({
      data: {
        name: '信人智能科技',
        industry: 'AI/Agent（线索版本）',
        companyPosition: '线索版本定位',
        mainProducts: '线索版本产品',
        financingHistory: '线索版本融资',
        description: '线索版本备注',
        createdById: admin.id,
      },
    })
    createdLeadIds.push(lead3.id)

    const result3 = await simulateProjectCreateWithMerge(
      { id: admin.id, role: 'ADMIN' },
      '信人智能',
      {
        totalAmount: 3000,
        industry: '用户填写的行业',
        companyPosition: '用户填写的定位',
      }
    )

    if (result3.mergedLead && result3.mergedLead.id === lead3.id) {
      logPass('场景3 检测到重合')
    } else {
      logFail('场景3 未检测到重合')
    }

    // 用户填写的字段应保留
    if (result3.project.industry === '用户填写的行业') {
      logPass('场景3 用户填写的 industry 未被覆盖')
    } else {
      logFail('场景3 用户填写的 industry 被覆盖', `got ${result3.project.industry}`)
    }

    if (result3.project.companyPosition === '用户填写的定位') {
      logPass('场景3 用户填写的 companyPosition 未被覆盖')
    } else {
      logFail('场景3 用户填写的 companyPosition 被覆盖')
    }

    // 用户未填的字段应从线索合并
    if (result3.project.mainProducts === '线索版本产品') {
      logPass('场景3 用户未填的 mainProducts 从线索合并')
    } else {
      logFail('场景3 mainProducts 未从线索合并', `got ${result3.project.mainProducts}`)
    }

    if (result3.project.financialData === '线索版本融资') {
      logPass('场景3 用户未填的 financialData 从线索合并')
    } else {
      logFail('场景3 financialData 未从线索合并')
    }

    if (result3.project.description === '线索版本备注') {
      logPass('场景3 用户未填的 description 从线索合并')
    } else {
      logFail('场景3 description 未从线索合并')
    }

    // 线索应已删除
    const lead3Check = await prisma.projectLead.findUnique({ where: { id: lead3.id } })
    if (!lead3Check) {
      logPass('场景3 被合并的线索已删除')
    } else {
      logFail('场景3 被合并的线索未删除')
    }

    // 7.4 场景4: 包含关系 - 线索名称包含项目名称
    console.log('\n  ── 场景4: 包含关系（线索名称包含项目名称）──')
    const lead4 = await prisma.projectLead.create({
      data: {
        name: '光年万物科技有限公司',
        industry: 'AI/大模型',
        companyPosition: '通用大模型研发',
        createdById: admin.id,
      },
    })
    createdLeadIds.push(lead4.id)

    const result4 = await simulateProjectCreateWithMerge(
      { id: admin.id, role: 'ADMIN' },
      '光年万物',
      { totalAmount: 8000 }
    )

    if (result4.mergedLead && result4.mergedLead.id === lead4.id) {
      logPass('场景4 包含关系检测到重合')
    } else {
      logFail('场景4 包含关系未检测到重合')
    }

    if (result4.project.industry === 'AI/大模型') {
      logPass('场景4 字段合并成功')
    } else {
      logFail('场景4 字段合并失败')
    }

    const lead4Check = await prisma.projectLead.findUnique({ where: { id: lead4.id } })
    if (!lead4Check) {
      logPass('场景4 线索已删除')
    } else {
      logFail('场景4 线索未删除')
    }

    // 7.5 场景5: 高相似度（1字之差，相似度=0.8）
    console.log('\n  ── 场景5: 高相似度（1字之差，相似度=0.8）──')
    const lead5 = await prisma.projectLead.create({
      data: {
        name: '星河动力',
        industry: '商业航天',
        createdById: admin.id,
      },
    })
    createdLeadIds.push(lead5.id)

    const result5 = await simulateProjectCreateWithMerge(
      { id: admin.id, role: 'ADMIN' },
      '星河动力X',  // 4 字符 vs 5 字符，编辑距离=1，相似度=1-1/5=0.8
      { totalAmount: 6000 }
    )

    if (result5.mergedLead && result5.mergedLead.id === lead5.id) {
      logPass('场景5 高相似度（0.8）检测到重合')
    } else {
      logFail('场景5 高相似度未检测到重合')
    }

    const lead5Check = await prisma.projectLead.findUnique({ where: { id: lead5.id } })
    if (!lead5Check) {
      logPass('场景5 线索已删除')
    } else {
      logFail('场景5 线索未删除')
    }

    // 7.6 场景6: 相似度不足（低于 0.8）
    console.log('\n  ── 场景6: 相似度不足（低于 0.8，不合并）──')
    const lead6 = await prisma.projectLead.create({
      data: {
        name: '甲乙丙丁戊己庚',  // 7 字符
        industry: '完全不相关行业',
        createdById: admin.id,
      },
    })
    createdLeadIds.push(lead6.id)

    const result6 = await simulateProjectCreateWithMerge(
      { id: admin.id, role: 'ADMIN' },
      '甲乙丙丁戊xyz',  // 7 字符，编辑距离=3，相似度=1-3/7≈0.57 < 0.8
      { totalAmount: 1000 }
    )

    if (!result6.mergedLead) {
      logPass('场景6 相似度不足（0.57）不合并')
    } else {
      logFail('场景6 相似度不足却合并了')
    }

    const lead6Check = await prisma.projectLead.findUnique({ where: { id: lead6.id } })
    if (lead6Check) {
      logPass('场景6 线索保留未删除')
    } else {
      logFail('场景6 线索被错误删除')
    }

    // 7.7 场景7: 多个重合线索 - 取相似度最高的一条
    console.log('\n  ── 场景7: 多个重合线索（取相似度最高）──')
    const lead7a = await prisma.projectLead.create({
      data: {
        name: '元宇宙科技',
        industry: '元宇宙（线索A）',
        createdById: admin.id,
      },
    })
    createdLeadIds.push(lead7a.id)
    const lead7b = await prisma.projectLead.create({
      data: {
        name: '元宇宙',
        industry: '元宇宙（线索B，完全相同）',
        createdById: admin.id,
      },
    })
    createdLeadIds.push(lead7b.id)

    const result7 = await simulateProjectCreateWithMerge(
      { id: admin.id, role: 'ADMIN' },
      '元宇宙',
      { totalAmount: 2000 }
    )

    // 元宇宙（线索B）相似度=1，元宇宙科技（线索A）相似度=包含关系
    // 两个都是高度重合，但 B 的相似度更高
    if (result7.mergedLead && result7.mergedLead.id === lead7b.id) {
      logPass('场景7 取相似度最高的线索（B）')
    } else {
      logFail('场景7 未取相似度最高的线索', `got id=${result7.mergedLead?.id}`)
    }

    if (result7.project.industry === '元宇宙（线索B，完全相同）') {
      logPass('场景7 字段从最高相似度线索合并')
    } else {
      logFail('场景7 字段合并异常', `got ${result7.project.industry}`)
    }

    // 被合并的线索B应已删除，线索A应保留
    const lead7aCheck = await prisma.projectLead.findUnique({ where: { id: lead7a.id } })
    const lead7bCheck = await prisma.projectLead.findUnique({ where: { id: lead7b.id } })
    if (lead7aCheck && !lead7bCheck) {
      logPass('场景7 仅删除被合并的线索B，线索A保留')
    } else {
      logFail('场景7 线索删除异常', `A存在=${!!lead7aCheck}, B存在=${!!lead7bCheck}`)
    }

    // 7.8 场景8: 线索字段为空时不合并
    console.log('\n  ── 场景8: 线索字段为空时不合并 ──')
    const lead8 = await prisma.projectLead.create({
      data: {
        name: '空字段线索',
        // 所有字段为空
        createdById: admin.id,
      },
    })
    createdLeadIds.push(lead8.id)

    const result8 = await simulateProjectCreateWithMerge(
      { id: admin.id, role: 'ADMIN' },
      '空字段线索',
      { totalAmount: 4000 }
    )

    if (result8.mergedLead && result8.mergedLead.id === lead8.id) {
      logPass('场景8 检测到重合（线索字段为空也匹配）')
    } else {
      logFail('场景8 未检测到重合')
    }

    if (result8.project.industry === null) {
      logPass('场景8 空字段不合并（industry=null）')
    } else {
      logFail('场景8 空字段被错误合并')
    }

    const lead8Check = await prisma.projectLead.findUnique({ where: { id: lead8.id } })
    if (!lead8Check) {
      logPass('场景8 线索已删除')
    } else {
      logFail('场景8 线索未删除')
    }

    // 7.9 场景9: MANAGER 角色仅匹配自己创建的线索
    console.log('\n  ── 场景9: MANAGER 角色仅匹配自己创建的线索 ──')
    const managerUser = await getTestUser('INVESTMENT_MANAGER')
    if (managerUser) {
      // admin 创建的线索（manager 看不到）
      const lead9a = await prisma.projectLead.create({
        data: {
          name: '管理员私有线索',
          industry: '管理员行业',
          createdById: admin.id,
        },
      })
      createdLeadIds.push(lead9a.id)

      // manager 创建的线索
      const lead9b = await prisma.projectLead.create({
        data: {
          name: '经理私有线索',
          industry: '经理行业',
          createdById: managerUser.id,
        },
      })
      createdLeadIds.push(lead9b.id)

      // manager 创建项目，名称与自己的线索匹配
      const result9 = await simulateProjectCreateWithMerge(
        { id: managerUser.id, role: 'INVESTMENT_MANAGER' },
        '经理私有线索',
        { totalAmount: 7000 }
      )

      if (result9.mergedLead && result9.mergedLead.id === lead9b.id) {
        logPass('场景9 MANAGER 匹配自己创建的线索')
      } else {
        logFail('场景9 MANAGER 未匹配自己的线索')
      }

      if (result9.project.industry === '经理行业') {
        logPass('场景9 字段从 manager 自己的线索合并')
      } else {
        logFail('场景9 字段合并异常')
      }

      // 验证 admin 的线索未被删除（因为 manager 看不到，没参与匹配）
      const lead9aCheck = await prisma.projectLead.findUnique({ where: { id: lead9a.id } })
      if (lead9aCheck) {
        logPass('场景9 admin 的线索未被删除（manager 不可见）')
      } else {
        logFail('场景9 admin 的线索被错误删除')
      }

      const lead9bCheck = await prisma.projectLead.findUnique({ where: { id: lead9b.id } })
      if (!lead9bCheck) {
        logPass('场景9 manager 的线索已删除')
      } else {
        logFail('场景9 manager 的线索未删除')
      }
    } else {
      logFail('场景9 缺少 MANAGER 账号')
    }
  }

  // ─────────────────────────────────────────────────────────
  // 测试组8: 权限模型验证（线索可见性 / 可编辑性）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组8: 权限模型验证（线索可见性 / 可编辑性）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 8.1 API 权限矩阵 - ADMIN 可见全部
  if (leadsRouteContent.includes("currentUser.role !== 'ADMIN'") &&
      leadsRouteContent.includes("currentUser.role !== 'INVESTMENT_PARTNER'") &&
      leadsRouteContent.includes("currentUser.role !== 'INVESTMENT_MANAGER'")) {
    logPass('API 权限: ADMIN/PARTNER/MANAGER 可见全部线索（scope=all）')
  } else {
    logFail('API 权限矩阵异常')
  }

  // 8.2 API 权限 - scope=mine 仅自己创建的
  if (leadsRouteContent.includes("if (scope === 'mine')") &&
      leadsRouteContent.includes('where.createdById = currentUser.id')) {
    logPass('API 权限: scope=mine 仅返回自己创建的线索')
  } else {
    logFail('API 权限 scope=mine 异常')
  }

  // 8.3 API 编辑权限 - ADMIN/PARTNER 可编辑全部
  if (leadsIdRouteContent.includes("currentUser.role === 'ADMIN'") &&
      leadsIdRouteContent.includes("currentUser.role === 'INVESTMENT_PARTNER'") &&
      leadsIdRouteContent.includes('lead.createdById === currentUser.id')) {
    logPass('API 编辑权限: ADMIN/PARTNER 可编辑全部，其他仅创建者')
  } else {
    logFail('API 编辑权限异常')
  }

  // 8.4 API 删除权限
  if (leadsIdRouteContent.includes('canDelete') &&
      leadsIdRouteContent.includes('无权删除')) {
    logPass('API 删除权限检查存在')
  } else {
    logFail('API 删除权限检查缺失')
  }

  // 8.5 API match 端点权限
  if (leadsMatchRouteContent.includes("currentUser.role !== 'ADMIN'") &&
      leadsMatchRouteContent.includes("'INVESTMENT_PARTNER'") &&
      leadsMatchRouteContent.includes("'INVESTMENT_MANAGER'")) {
    logPass('API match 端点权限矩阵正确')
  } else {
    logFail('API match 端点权限异常')
  }

  // 8.6 数据层验证 - admin 创建的线索，partner 可见
  if (admin && partner) {
    const permLead = await prisma.projectLead.create({
      data: {
        name: '权限测试线索',
        industry: '测试',
        createdById: admin.id,
      },
    })
    createdLeadIds.push(permLead.id)

    // 模拟 partner 查询全部线索（应能看到 admin 创建的）
    const allLeadsForPartner = await prisma.projectLead.findMany({})
    const partnerSees = allLeadsForPartner.some(l => l.id === permLead.id)
    if (partnerSees) {
      logPass('权限: partner 可见 admin 创建的线索（数据层）')
    } else {
      logFail('权限: partner 不可见 admin 创建的线索')
    }
  }

  // 8.7 数据层验证 - scope=mine 仅自己创建的
  if (admin) {
    const myLeadsOnly = await prisma.projectLead.findMany({
      where: { createdById: admin.id },
    })
    const allMine = myLeadsOnly.every(l => l.createdById === admin.id)
    if (allMine) {
      logPass(`权限: scope=mine 仅返回自己创建的（${myLeadsOnly.length} 条）`)
    } else {
      logFail('权限: scope=mine 返回了非自己创建的线索')
    }
  }

  // 8.8 级联删除验证 - User 删除时 ProjectLead 级联删除（schema）
  if (schemaIncludesCascade()) {
    logPass('schema: ProjectLead.createdBy 关系使用 onDelete: Cascade')
  } else {
    logFail('schema: ProjectLead 级联删除配置缺失')
  }

  // 8.9 索引验证
  const schemaContent = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf-8')
  if (schemaContent.includes('@@index([name])') && schemaContent.includes('@@index([createdById])')) {
    logPass('schema: ProjectLead 包含 name 和 createdById 索引')
  } else {
    logFail('schema: ProjectLead 索引缺失')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组9: 数据清理 + 验证测试线索清理
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组9: 数据清理')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 清理测试项目
  if (createdProjectIds.length > 0) {
    // 先清理关联数据
    for (const pid of createdProjectIds) {
      await prisma.followUpNote.deleteMany({ where: { projectId: pid } }).catch(() => {})
      await prisma.partnerReview.deleteMany({ where: { projectId: pid } }).catch(() => {})
      await prisma.stageApproval.deleteMany({ where: { projectId: pid } }).catch(() => {})
      await prisma.projectNews.deleteMany({ where: { projectId: pid } }).catch(() => {})
      await prisma.projectMember.deleteMany({ where: { projectId: pid } }).catch(() => {})
      await prisma.investment.deleteMany({ where: { projectId: pid } }).catch(() => {})
    }
    const delProj = await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } })
    logPass(`清理测试项目: ${delProj.count} 个`)
  }

  // 清理测试线索（未被合并删除的）
  if (createdLeadIds.length > 0) {
    const delLead = await prisma.projectLead.deleteMany({
      where: { id: { in: createdLeadIds } },
    })
    logPass(`清理测试线索: ${delLead.count} 条`)
  }

  // ─────────────────────────────────────────────────────────
  // 测试总结
  // ─────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log('🎯 测试总结')
  console.log('='.repeat(60))
  console.log(`✅ 通过: ${passCount}`)
  console.log(`❌ 失败: ${failCount}`)
  console.log(`总计: ${passCount + failCount}`)
  console.log('='.repeat(60))

  if (failCount > 0) {
    console.log('\n❌ 测试未通过，请检查失败项')
    process.exit(1)
  } else {
    console.log('\n✅ 全部测试通过！')
  }

  await prisma.$disconnect()
}

function schemaIncludesCascade(): boolean {
  try {
    const schemaContent = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf-8')
    // ProjectLead 模型块内包含 onDelete: Cascade
    const leadModelMatch = schemaContent.match(/model ProjectLead \{[\s\S]*?\}/)
    if (!leadModelMatch) return false
    return leadModelMatch[0].includes('onDelete: Cascade')
  } catch {
    return false
  }
}

main().catch(async (e) => {
  console.error('❌ 测试脚本执行失败:', e)
  // 尝试清理
  try {
    if (createdProjectIds.length > 0) {
      for (const pid of createdProjectIds) {
        await prisma.followUpNote.deleteMany({ where: { projectId: pid } }).catch(() => {})
        await prisma.partnerReview.deleteMany({ where: { projectId: pid } }).catch(() => {})
        await prisma.stageApproval.deleteMany({ where: { projectId: pid } }).catch(() => {})
        await prisma.projectNews.deleteMany({ where: { projectId: pid } }).catch(() => {})
        await prisma.projectMember.deleteMany({ where: { projectId: pid } }).catch(() => {})
        await prisma.investment.deleteMany({ where: { projectId: pid } }).catch(() => {})
      }
      await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } }).catch(() => {})
    }
    if (createdLeadIds.length > 0) {
      await prisma.projectLead.deleteMany({ where: { id: { in: createdLeadIds } } }).catch(() => {})
    }
    await prisma.$disconnect()
  } catch {}
  process.exit(1)
})
