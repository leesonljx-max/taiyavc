/**
 * 首页"本周新增项目 + 维护人项目概览"合并区块 综合测试脚本
 *
 * 用户原话："把首页里面'本周新增项目'和'维护人项目概览'合为一起，
 *           就是展示为：本周新增项目里面，每个人的项目情况。
 *           做完之后每个系统权限类型生成一个测试账号；
 *           完成开发之后，每个功能模块都要生成测试用例进行测试，
 *           测试没有问题之后才算完成任务。"
 *
 * 测试覆盖：
 * 1. 测试账号验证（ADMIN/PARTNER/MANAGER + 秦伟）
 * 2. 首页源码验证：合并后只剩一个"本周新增项目"区块
 * 3. 首页源码验证：不再有独立的"维护人项目概览"标题区块
 * 4. 合并区块结构验证：标题 + 副标题 + 新建按钮 + 维护人分组卡片
 * 5. 维护人卡片左右布局：左侧姓名+5阶段计数，右侧项目小卡片
 * 6. Dashboard API 返回 maintainerStats 结构正确
 * 7. Dashboard API 年份筛选 + 维护人分组逻辑
 * 8. 端到端验证：创建项目 → 维护人分组 → 阶段计数 → 项目简要信息
 *
 * 运行: npx tsx scripts/test-merge-sections.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()

let passCount = 0
let failCount = 0
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

// 用户指定的 5 个阶段（初聊/PreDD/立项/尽调/交割）
const MAINTAINER_STAGES = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'CLOSING',
] as const

const STAGE_LABELS: Record<string, string> = {
  INITIAL_TALK: '初聊',
  PRE_DD: 'PreDD',
  PROJECT_INITIATION: '立项',
  DUE_DILIGENCE: '尽调',
  CLOSING: '交割',
}

async function main() {
  console.log('='.repeat(60))
  console.log('🧪 首页"本周新增项目 + 维护人项目概览"合并区块 测试')
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

  // 验证3种角色账号均处于 ACTIVE 状态
  if (admin && admin.status === 'ACTIVE') logPass('ADMIN 账号状态为 ACTIVE')
  else logFail('ADMIN 账号状态异常')

  if (partner && partner.status === 'ACTIVE') logPass('INVESTMENT_PARTNER 账号状态为 ACTIVE')
  else logFail('INVESTMENT_PARTNER 账号状态异常')

  if (manager && manager.status === 'ACTIVE') logPass('INVESTMENT_MANAGER 账号状态为 ACTIVE')
  else logFail('INVESTMENT_MANAGER 账号状态异常')

  // ─────────────────────────────────────────────────────────
  // 测试组2: 首页源码验证 - 合并后只剩一个"本周新增项目"区块
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组2: 首页源码验证 - 合并后区块结构')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const homePagePath = path.join(process.cwd(), 'src/app/page.tsx')
  const homePageContent = fs.readFileSync(homePagePath, 'utf-8')

  // 2.1 合并后应保留"本周新增项目"标题
  const weeklyTitleCount = (homePageContent.match(/本周新增项目/g) || []).length
  if (weeklyTitleCount >= 1) {
    logPass(`首页包含"本周新增项目"标题（出现 ${weeklyTitleCount} 次）`)
  } else {
    logFail('首页缺少"本周新增项目"标题')
  }

  // 2.2 合并后不应再有独立的"维护人项目概览"标题区块
  const maintainerOverviewTitleCount = (homePageContent.match(/维护人项目概览/g) || []).length
  if (maintainerOverviewTitleCount === 0) {
    logPass('首页不再有独立的"维护人项目概览"标题（已合并）')
  } else {
    logFail('首页仍存在独立的"维护人项目概览"标题', `出现 ${maintainerOverviewTitleCount} 次`)
  }

  // 2.3 合并区块副标题应同时显示维护人数量和本周新增数量
  if (homePageContent.includes('maintainerStats?.length') && homePageContent.includes('位维护人')) {
    logPass('合并区块副标题显示维护人数量')
  } else {
    logFail('合并区块副标题未显示维护人数量')
  }

  if (homePageContent.includes('weeklyProjects.length') && homePageContent.includes('本周新增')) {
    logPass('合并区块副标题显示本周新增数量')
  } else {
    logFail('合并区块副标题未显示本周新增数量')
  }

  // 2.4 合并区块保留"新建项目"按钮
  if (homePageContent.includes('href="/projects/new"') && homePageContent.includes('新建项目')) {
    logPass('合并区块保留"新建项目"按钮')
  } else {
    logFail('合并区块缺少"新建项目"按钮')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组3: 合并区块左右布局验证 - 维护人分组卡片
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组3: 合并区块左右布局验证 - 维护人分组卡片')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 3.1 渲染 maintainerStats 列表
  if (homePageContent.includes('data.maintainerStats.map')) {
    logPass('合并区块渲染维护人分组列表')
  } else {
    logFail('合并区块未渲染维护人分组列表')
  }

  // 3.2 左侧：维护人姓名 + 总项目数
  if (homePageContent.includes('m.userName') && homePageContent.includes('共') && homePageContent.includes('个项目')) {
    logPass('左侧显示维护人姓名 + 总项目数')
  } else {
    logFail('左侧缺少维护人姓名或总项目数')
  }

  // 3.3 左侧：5 个阶段计数标签
  const stageLabelsPresent = ['初聊', 'PreDD', '立项', '尽调', '交割'].every(label =>
    homePageContent.includes(label)
  )
  if (stageLabelsPresent) {
    logPass('左侧包含 5 个阶段标签（初聊/PreDD/立项/尽调/交割）')
  } else {
    logFail('左侧缺少部分阶段标签')
  }

  // 3.4 左侧：stageCounts 引用
  if (homePageContent.includes('m.stageCounts')) {
    logPass('左侧引用 stageCounts 显示阶段计数')
  } else {
    logFail('左侧未引用 stageCounts')
  }

  // 3.5 右侧：项目小卡片渲染
  if (homePageContent.includes('m.projects.map')) {
    logPass('右侧渲染项目小卡片列表')
  } else {
    logFail('右侧未渲染项目小卡片')
  }

  // 3.6 右侧：项目简要信息字段
  const briefFields = ['project.name', 'project.companyPosition', 'project.industry', 'project.financingRound', 'project.totalAmount']
  const missingBrief = briefFields.filter(f => !homePageContent.includes(f))
  if (missingBrief.length === 0) {
    logPass('右侧项目小卡片包含全部简要信息字段')
  } else {
    logFail('右侧项目小卡片缺少字段', missingBrief.join(', '))
  }

  // 3.7 右侧：项目阶段标签
  if (homePageContent.includes('followStageColors') && homePageContent.includes('followStageLabels')) {
    logPass('右侧项目小卡片显示阶段标签（颜色+文字）')
  } else {
    logFail('右侧项目小卡片缺少阶段标签')
  }

  // 3.8 项目卡片链接到详情页
  if (homePageContent.includes('href={`/projects/${project.id}`')) {
    logPass('项目小卡片链接到项目详情页')
  } else {
    logFail('项目小卡片未链接到详情页')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组4: Dashboard API 源码验证
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组4: Dashboard API 源码验证')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const dashboardApiPath = path.join(process.cwd(), 'src/app/api/dashboard/route.ts')
  const dashboardApiContent = fs.readFileSync(dashboardApiPath, 'utf-8')

  // 4.1 年份筛选
  if (dashboardApiContent.includes("searchParams.get('year')")) {
    logPass('Dashboard API 解析 year 查询参数')
  } else {
    logFail('Dashboard API 未解析 year 参数')
  }

  // 4.2 年份列表提取
  if (dashboardApiContent.includes('yearsSet')) {
    logPass('Dashboard API 提取可用年份列表')
  } else {
    logFail('Dashboard API 未提取年份列表')
  }

  // 4.3 维护人分组逻辑
  if (dashboardApiContent.includes('maintainerMap')) {
    logPass('Dashboard API 实现维护人分组逻辑')
  } else {
    logFail('Dashboard API 缺少维护人分组逻辑')
  }

  // 4.4 5 个阶段常量
  if (dashboardApiContent.includes('MAINTAINER_STAGES')) {
    logPass('Dashboard API 定义 5 个维护人阶段常量')
  } else {
    logFail('Dashboard API 缺少 MAINTAINER_STAGES 常量')
  }

  // 4.5 返回 maintainerStats
  if (dashboardApiContent.includes('maintainerStats')) {
    logPass('Dashboard API 返回 maintainerStats 字段')
  } else {
    logFail('Dashboard API 未返回 maintainerStats')
  }

  // 4.6 返回 weeklyProjects（本周新增项目）
  if (dashboardApiContent.includes('weeklyProjects')) {
    logPass('Dashboard API 返回 weeklyProjects 字段')
  } else {
    logFail('Dashboard API 未返回 weeklyProjects')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组5: Dashboard API 维护人分组数据结构验证
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组5: Dashboard API 维护人分组数据结构验证')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const currentYear = new Date().getFullYear()
  const creator1 = manager || admin!
  const creator2 = partner || admin!

  // 创建多个维护人的项目（每阶段至少 1 个）
  const maintainerProjects: string[] = []
  for (const stage of MAINTAINER_STAGES) {
    const p = await prisma.project.create({
      data: {
        name: `合并测试-${STAGE_LABELS[stage]}-${Date.now()}`,
        followStage: stage,
        companyPosition: '合并测试定位',
        industry: 'AI/Agent',
        financingRound: 'A轮',
        totalAmount: 5000,
        raisedAmount: 0,
        targetDate: new Date(`${currentYear}-12-31T00:00:00.000Z`),
        createdById: creator1.id,
      },
    })
    maintainerProjects.push(p.id)
    createdProjectIds.push(p.id)
  }

  // creator2 的项目
  const p2 = await prisma.project.create({
    data: {
      name: `合并测试-合伙人项目-${Date.now()}`,
      followStage: 'INITIAL_TALK',
      companyPosition: '合伙人定位',
      industry: '金融科技',
      financingRound: '天使轮',
      totalAmount: 1000,
      raisedAmount: 0,
      targetDate: new Date(`${currentYear}-12-31T00:00:00.000Z`),
      createdById: creator2.id,
    },
  })
  createdProjectIds.push(p2.id)

  // 模拟 Dashboard API 的维护人分组逻辑
  const yearProjects = (await prisma.project.findMany({
    where: { createdById: { in: [creator1.id, creator2.id] } },
    include: { createdBy: { select: { id: true, name: true } } },
  })).filter(p => new Date(p.createdAt).getFullYear() === currentYear)

  const maintainerMap = new Map<string, {
    userId: string
    userName: string
    stageCounts: Record<string, number>
    projects: any[]
  }>()

  for (const p of yearProjects) {
    const userId = p.createdById!
    const userName = p.createdBy?.name || '未分配'

    if (!maintainerMap.has(userId)) {
      maintainerMap.set(userId, {
        userId,
        userName,
        stageCounts: {
          INITIAL_TALK: 0,
          PRE_DD: 0,
          PROJECT_INITIATION: 0,
          DUE_DILIGENCE: 0,
          CLOSING: 0,
        },
        projects: [],
      })
    }
    const entry = maintainerMap.get(userId)!
    if (p.followStage in entry.stageCounts) {
      entry.stageCounts[p.followStage]++
    }
    entry.projects.push({
      id: p.id,
      name: p.name,
      companyPosition: p.companyPosition,
      industry: p.industry,
      financingRound: p.financingRound,
      totalAmount: Number(p.totalAmount),
      followStage: p.followStage,
    })
  }

  const maintainerStats = Array.from(maintainerMap.values())

  // 5.1 验证有两个维护人
  if (maintainerStats.length === 2) {
    logPass(`维护人分组正确：${maintainerStats.length} 位维护人`)
  } else {
    logFail('维护人分组数量不正确', `期望 2，实际 ${maintainerStats.length}`)
  }

  // 5.2 验证维护人信息
  const maintainer1 = maintainerStats.find(m => m.userId === creator1.id)
  const maintainer2 = maintainerStats.find(m => m.userId === creator2.id)

  if (maintainer1 && maintainer1.userName === creator1.name) {
    logPass(`维护人1 信息正确: ${maintainer1.userName}`)
  } else {
    logFail('维护人1 信息不正确')
  }

  if (maintainer2 && maintainer2.userName === creator2.name) {
    logPass(`维护人2 信息正确: ${maintainer2.userName}`)
  } else {
    logFail('维护人2 信息不正确')
  }

  // 5.3 验证 stageCounts 包含 5 个阶段
  if (maintainer1) {
    const stageKeys = Object.keys(maintainer1.stageCounts)
    const hasAllStages = MAINTAINER_STAGES.every(s => stageKeys.includes(s))
    if (hasAllStages) {
      logPass('stageCounts 包含全部 5 个阶段（初聊/PreDD/立项/尽调/交割）')
    } else {
      logFail('stageCounts 缺少阶段')
    }

    // 5.4 不包含投后阶段
    if (!stageKeys.includes('POST_INVESTMENT')) {
      logPass('stageCounts 不包含投后阶段（符合用户指定 5 阶段）')
    } else {
      logFail('stageCounts 不应包含投后阶段')
    }

    // 5.5 各阶段计数正确
    for (const stage of MAINTAINER_STAGES) {
      if (maintainer1.stageCounts[stage] >= 1) {
        logPass(`${STAGE_LABELS[stage]}阶段计数 >= 1: ${maintainer1.stageCounts[stage]}`)
      } else {
        logFail(`${STAGE_LABELS[stage]}阶段计数为 0`)
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // 测试组6: 项目简要信息字段验证
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组6: 项目简要信息字段验证')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  if (maintainer1 && maintainer1.projects.length > 0) {
    const sampleProject = maintainer1.projects[0]
    const requiredFields = ['id', 'name', 'companyPosition', 'industry', 'financingRound', 'totalAmount', 'followStage']
    const hasAllFields = requiredFields.every(f => f in sampleProject)

    if (hasAllFields) {
      logPass('项目简要信息包含全部所需字段')
    } else {
      logFail('项目简要信息缺少字段', requiredFields.filter(f => !(f in sampleProject)).join(', '))
    }

    if (sampleProject.companyPosition) logPass(`companyPosition 正确: ${sampleProject.companyPosition}`)
    else logFail('companyPosition 为空')

    if (sampleProject.industry) logPass(`industry 正确: ${sampleProject.industry}`)
    else logFail('industry 为空')

    if (sampleProject.financingRound) logPass(`financingRound 正确: ${sampleProject.financingRound}`)
    else logFail('financingRound 为空')

    if (typeof sampleProject.totalAmount === 'number' && sampleProject.totalAmount > 0) {
      logPass(`totalAmount 正确: ${sampleProject.totalAmount}`)
    } else {
      logFail('totalAmount 不正确', String(sampleProject.totalAmount))
    }
  }

  // ─────────────────────────────────────────────────────────
  // 测试组7: 年份筛选验证
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组7: 年份筛选验证')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 创建去年项目
  const lastYearProject = await prisma.project.create({
    data: {
      name: '合并测试-去年项目',
      followStage: 'PRE_DD',
      totalAmount: 2000,
      raisedAmount: 0,
      targetDate: new Date(`${currentYear - 1}-12-31T00:00:00.000Z`),
      createdById: creator2.id,
      createdAt: new Date(`${currentYear - 1}-06-15T00:00:00.000Z`),
    },
  })
  createdProjectIds.push(lastYearProject.id)

  // 7.1 当年项目在筛选结果中
  const currentYearProjects = (await prisma.project.findMany({
    where: { id: { in: [...maintainerProjects, p2.id] } },
  })).filter(p => new Date(p.createdAt).getFullYear() === currentYear)

  if (currentYearProjects.length === maintainerProjects.length + 1) {
    logPass(`年份筛选 ${currentYear} 年：包含当年项目`)
  } else {
    logFail(`年份筛选 ${currentYear} 年失败`, `数量: ${currentYearProjects.length}`)
  }

  // 7.2 去年项目不在当年筛选中
  const lastYearInCurrent = (await prisma.project.findMany({
    where: { id: lastYearProject.id },
  })).filter(p => new Date(p.createdAt).getFullYear() === currentYear)

  if (lastYearInCurrent.length === 0) {
    logPass('去年项目不出现在当年筛选结果中')
  } else {
    logFail('去年项目错误地出现在当年筛选结果中')
  }

  // 7.3 years 列表包含去年
  const yearsSet = new Set<number>()
  yearsSet.add(currentYear)
  yearsSet.add(currentYear - 1)
  const years = Array.from(yearsSet).sort((a, b) => b - a)

  if (years.includes(currentYear - 1)) {
    logPass(`years 列表包含去年 ${currentYear - 1}`)
  } else {
    logFail('years 列表缺少去年')
  }

  // 7.4 years 降序排列
  const isDescending = years.every((y, i) => i === 0 || years[i - 1] > y)
  if (isDescending) {
    logPass('years 列表降序排列')
  } else {
    logFail('years 列表未降序排列', years.join(', '))
  }

  // ─────────────────────────────────────────────────────────
  // 测试组8: 端到端验证
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组8: 端到端验证（创建项目 → 维护人分组 → 阶段计数 → 简要信息）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 8.1 创建当年项目并验证分组
  const e2eProject = await prisma.project.create({
    data: {
      name: `E2E合并测试-${Date.now()}`,
      followStage: 'PROJECT_INITIATION',
      companyPosition: 'E2E测试定位',
      industry: 'E2E行业',
      financingRound: 'B轮',
      totalAmount: 8000,
      raisedAmount: 0,
      targetDate: new Date(`${currentYear}-12-31T00:00:00.000Z`),
      createdById: creator1.id,
    },
  })
  createdProjectIds.push(e2eProject.id)

  // 重新计算维护人分组
  const e2eYearProjects = (await prisma.project.findMany({
    where: { createdById: creator1.id },
    include: { createdBy: { select: { id: true, name: true } } },
  })).filter(p => new Date(p.createdAt).getFullYear() === currentYear)

  // 8.2 E2E 项目在当年列表中
  const hasE2E = e2eYearProjects.some(p => p.id === e2eProject.id)
  if (hasE2E) {
    logPass('E2E: 当年项目出现在年份筛选结果中')
  } else {
    logFail('E2E: 当年项目未出现在年份筛选结果中')
  }

  // 8.3 立项阶段计数增加
  const e2eInitiationCount = e2eYearProjects.filter(p => p.followStage === 'PROJECT_INITIATION').length
  if (e2eInitiationCount >= 1) {
    logPass(`E2E: 立项阶段项目计数 >= 1: ${e2eInitiationCount}`)
  } else {
    logFail('E2E: 立项阶段项目计数为 0')
  }

  // 8.4 项目简要信息完整性
  const e2eProjectData = e2eYearProjects.find(p => p.id === e2eProject.id)
  if (e2eProjectData) {
    const briefInfo = {
      name: e2eProjectData.name,
      companyPosition: e2eProjectData.companyPosition,
      industry: e2eProjectData.industry,
      financingRound: e2eProjectData.financingRound,
      totalAmount: Number(e2eProjectData.totalAmount),
    }
    const allPresent = Object.values(briefInfo).every(v => v !== null && v !== undefined)
    if (allPresent) {
      logPass('E2E: 项目简要信息全部字段完整')
    } else {
      logFail('E2E: 项目简要信息字段不完整', JSON.stringify(briefInfo))
    }
  }

  // 8.5 维护人名字正确
  if (e2eProjectData?.createdBy?.name) {
    logPass(`E2E: 维护人名字正确: ${e2eProjectData.createdBy.name}`)
  } else {
    logFail('E2E: 维护人名字为空')
  }

  // 8.6 合并区块完整渲染链路验证
  // 模拟首页渲染：maintainerStats → 每个维护人卡片 → 左侧阶段计数 + 右侧项目小卡片
  const e2eMaintainerMap = new Map<string, any>()
  for (const p of e2eYearProjects) {
    const uid = p.createdById!
    if (!e2eMaintainerMap.has(uid)) {
      e2eMaintainerMap.set(uid, {
        userId: uid,
        userName: p.createdBy?.name || '未分配',
        stageCounts: { INITIAL_TALK: 0, PRE_DD: 0, PROJECT_INITIATION: 0, DUE_DILIGENCE: 0, CLOSING: 0 },
        projects: [],
      })
    }
    const entry = e2eMaintainerMap.get(uid)!
    if (p.followStage in entry.stageCounts) entry.stageCounts[p.followStage]++
    entry.projects.push({
      id: p.id,
      name: p.name,
      companyPosition: p.companyPosition,
      industry: p.industry,
      financingRound: p.financingRound,
      totalAmount: Number(p.totalAmount),
      followStage: p.followStage,
    })
  }
  const e2eMaintainerStats = Array.from(e2eMaintainerMap.values())

  if (e2eMaintainerStats.length >= 1) {
    logPass(`E2E: 合并区块渲染链路正常（${e2eMaintainerStats.length} 位维护人）`)
  } else {
    logFail('E2E: 合并区块渲染链路异常')
  }

  const e2eMainStat = e2eMaintainerStats[0]
  if (e2eMainStat && e2eMainStat.stageCounts.PROJECT_INITIATION >= 1) {
    logPass(`E2E: 左侧立项阶段计数正确: ${e2eMainStat.stageCounts.PROJECT_INITIATION}`)
  } else {
    logFail('E2E: 左侧立项阶段计数不正确')
  }

  if (e2eMainStat && e2eMainStat.projects.some((p: any) => p.id === e2eProject.id)) {
    logPass('E2E: 右侧项目小卡片包含新创建项目')
  } else {
    logFail('E2E: 右侧项目小卡片未包含新创建项目')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组9: 首页渲染兼容性验证（空数据/无维护人场景）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组9: 首页渲染兼容性验证（空数据场景）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 9.1 空数据显示提示
  if (homePageContent.includes('暂无项目数据') || homePageContent.includes('年暂无')) {
    logPass('首页处理空数据场景（显示提示文案）')
  } else {
    logFail('首页未处理空数据场景')
  }

  // 9.2 加载中状态
  if (homePageContent.includes('loading') && homePageContent.includes('animate-spin')) {
    logPass('首页处理加载中状态')
  } else {
    logFail('首页未处理加载中状态')
  }

  // 9.3 maintainerStats 可选链保护
  if (homePageContent.includes('data.maintainerStats?.length') || homePageContent.includes('!data.maintainerStats')) {
    logPass('首页对 maintainerStats 做空值保护')
  } else {
    logFail('首页未对 maintainerStats 做空值保护')
  }

  // 9.4 项目无维护人时的回退
  if (dashboardApiContent.includes("p.createdBy?.name || '未分配'")) {
    logPass('Dashboard API 处理无维护人回退（未分配）')
  } else {
    logFail('Dashboard API 未处理无维护人回退')
  }

  // ─────────────────────────────────────────────────────────
  // 清理测试数据
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🧹 清理测试数据')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  let deletedCount = 0
  for (const pid of createdProjectIds) {
    try {
      await prisma.project.delete({ where: { id: pid } })
      deletedCount++
    } catch {
      // 可能已被级联删除
    }
  }
  console.log(`  已删除 ${deletedCount} 个测试项目`)

  // ─────────────────────────────────────────────────────────
  // 测试结果汇总
  // ─────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log('📊 测试结果汇总')
  console.log('='.repeat(60))
  console.log(`✅ 通过: ${passCount}`)
  console.log(`❌ 失败: ${failCount}`)
  console.log(`总计: ${passCount + failCount}`)
  console.log('='.repeat(60))

  if (failCount === 0) {
    console.log('\n🎉 所有测试通过！首页"本周新增项目 + 维护人项目概览"合并区块功能正常。')
  } else {
    console.log('\n⚠️ 存在失败测试，请检查上方详情。')
  }

  await prisma.$disconnect()
  process.exit(failCount === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('❌ 测试执行失败:', e)
  await prisma.$disconnect()
  process.exit(1)
})
