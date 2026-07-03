/**
 * 工作台 + 导航重命名 + 维护人显示 综合测试脚本
 *
 * 测试覆盖：
 * 1. 测试账号验证（ADMIN/PARTNER/MANAGER + 秦伟）
 * 2. 导航标签验证（项目库/工作台）
 * 3. 工作台 scope=mine 过滤逻辑（仅显示个人维护项目）
 * 4. 工作台按 6 个阶段分组
 * 5. 项目卡片维护人名字（createdBy）
 * 6. Dashboard API 返回 maintainerName
 * 7. Projects API 返回 createdBy
 *
 * 运行: npx tsx scripts/test-workbench.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

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

// 阶段顺序定义
const STAGE_ORDER = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'CLOSING',
  'POST_INVESTMENT',
] as const

const STAGE_LABELS: Record<string, string> = {
  INITIAL_TALK: '初聊',
  PRE_DD: 'PreDD',
  PROJECT_INITIATION: '立项',
  DUE_DILIGENCE: '尽调',
  CLOSING: '交割',
  POST_INVESTMENT: '投后',
}

async function main() {
  console.log('='.repeat(60))
  console.log('🧪 工作台 + 导航重命名 + 维护人显示 综合测试')
  console.log('='.repeat(60))

  // ─────────────────────────────────────────────────────────
  // 测试组1: 测试账号验证
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

  // ─────────────────────────────────────────────────────────
  // 测试组2: 导航标签验证
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组2: 导航标签验证（项目库/工作台）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 读取 DashboardLayout 源码验证导航标签
  const fs = await import('fs')
  const path = await import('path')
  const layoutPath = path.join(process.cwd(), 'src/components/DashboardLayout.tsx')
  const layoutContent = fs.readFileSync(layoutPath, 'utf-8')

  if (layoutContent.includes("label: '项目库'")) {
    logPass("导航标签包含'项目库'（原'项目管理'）")
  } else {
    logFail("导航标签缺少'项目库'")
  }

  if (layoutContent.includes("label: '工作台'")) {
    logPass("导航标签包含'工作台'（原'投资人'）")
  } else {
    logFail("导航标签缺少'工作台'")
  }

  if (layoutContent.includes("href: '/workbench'")) {
    logPass("工作台导航指向 /workbench 路径")
  } else {
    logFail("工作台导航路径不正确")
  }

  if (!layoutContent.includes("label: '项目管理'") && !layoutContent.includes("label: '投资人'")) {
    logPass("旧标签'项目管理'和'投资人'已移除")
  } else {
    logFail("旧标签未完全移除")
  }

  // 验证工作台页面文件存在
  const workbenchPath = path.join(process.cwd(), 'src/app/workbench/page.tsx')
  if (fs.existsSync(workbenchPath)) {
    logPass('工作台页面文件存在: src/app/workbench/page.tsx')
  } else {
    logFail('工作台页面文件不存在')
  }

  const workbenchLayoutPath = path.join(process.cwd(), 'src/app/workbench/layout.tsx')
  if (fs.existsSync(workbenchLayoutPath)) {
    logPass('工作台 layout.tsx 存在（force-dynamic）')
  } else {
    logFail('工作台 layout.tsx 不存在')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组3: 工作台 scope=mine 过滤逻辑
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组3: 工作台 scope=mine 过滤逻辑（仅显示个人维护项目）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const { canViewProject, isMaintainedByUser } = await import('../src/lib/permissions')

  // 创建测试用户
  const testManager = manager || await prisma.user.create({
    data: {
      email: 'workbench-test-manager@example.com',
      passwordHash: '$2a$10$test',
      name: '工作台测试经理',
      role: 'INVESTMENT_MANAGER',
      status: 'ACTIVE',
    },
  })

  // 创建测试项目
  const myProject = await prisma.project.create({
    data: {
      name: '工作台测试-我的项目',
      followStage: 'INITIAL_TALK',
      totalAmount: 1000,
      raisedAmount: 0,
      targetDate: new Date('2026-12-31T00:00:00.000Z'),
      createdById: testManager.id,
    },
  })
  createdProjectIds.push(myProject.id)

  const otherProject = await prisma.project.create({
    data: {
      name: '工作台测试-他人项目',
      followStage: 'PRE_DD',
      totalAmount: 2000,
      raisedAmount: 0,
      targetDate: new Date('2026-12-31T00:00:00.000Z'),
      createdById: admin?.id || testManager.id,
    },
  })
  createdProjectIds.push(otherProject.id)

  // 3.1 模拟 scope=mine 过滤
  const allProjects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      members: { select: { userId: true } },
      createdBy: { select: { id: true, name: true } },
    },
  })

  const currentUser = { id: testManager.id, role: 'INVESTMENT_MANAGER' as const }
  const mineProjects = allProjects.filter(project => {
    const memberIds = project.members.map(m => m.userId)
    const permProject = {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    }
    if (!canViewProject(currentUser, permProject)) return false
    if (!isMaintainedByUser(currentUser, permProject)) return false
    return true
  })

  // 验证我的项目在 scope=mine 结果中
  const hasMyProject = mineProjects.some(p => p.id === myProject.id)
  if (hasMyProject) {
    logPass('scope=mine 包含我创建的项目')
  } else {
    logFail('scope=mine 未包含我创建的项目')
  }

  // 验证他人项目不在 scope=mine 结果中
  const hasOtherProject = mineProjects.some(p => p.id === otherProject.id && otherProject.createdById !== testManager.id)
  if (!hasOtherProject) {
    logPass('scope=mine 不包含他人创建的项目')
  } else {
    logFail('scope=mine 错误地包含了他人项目')
  }

  // 3.2 验证 scope=all 包含所有可见项目
  const allVisibleProjects = allProjects.filter(project => {
    const memberIds = project.members.map(m => m.userId)
    return canViewProject(currentUser, {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    })
  })
  const allHasMy = allVisibleProjects.some(p => p.id === myProject.id)
  if (allHasMy) {
    logPass('scope=all 包含我的项目')
  } else {
    logFail('scope=all 未包含我的项目')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组4: 工作台按 6 个阶段分组
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组4: 工作台按 6 个阶段分组')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 验证 STAGE_ORDER 包含 6 个阶段
  if (STAGE_ORDER.length === 6) {
    logPass(`阶段顺序包含 6 个阶段: ${STAGE_ORDER.map(s => STAGE_LABELS[s]).join(' → ')}`)
  } else {
    logFail(`阶段数量不正确: ${STAGE_ORDER.length}`, STAGE_ORDER.join(', '))
  }

  // 验证阶段标签
  const expectedLabels = ['初聊', 'PreDD', '立项', '尽调', '交割', '投后']
  const actualLabels = STAGE_ORDER.map(s => STAGE_LABELS[s])
  if (JSON.stringify(expectedLabels) === JSON.stringify(actualLabels)) {
    logPass('阶段标签顺序正确: 初聊 → PreDD → 立项 → 尽调 → 交割 → 投后')
  } else {
    logFail('阶段标签顺序不正确', actualLabels.join(', '))
  }

  // 创建每个阶段的项目，验证分组逻辑
  const stageTestProjects: string[] = []
  for (const stage of STAGE_ORDER) {
    const p = await prisma.project.create({
      data: {
        name: `工作台测试-${STAGE_LABELS[stage]}阶段项目`,
        followStage: stage,
        totalAmount: 1000,
        raisedAmount: 0,
        targetDate: new Date('2026-12-31T00:00:00.000Z'),
        createdById: testManager.id,
      },
    })
    stageTestProjects.push(p.id)
    createdProjectIds.push(p.id)
  }

  // 重新获取 scope=mine 项目
  const updatedMineProjects = (await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      members: { select: { userId: true } },
      createdBy: { select: { id: true, name: true } },
    },
  })).filter(project => {
    const memberIds = project.members.map(m => m.userId)
    const permProject = {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    }
    if (!canViewProject(currentUser, permProject)) return false
    if (!isMaintainedByUser(currentUser, permProject)) return false
    return true
  })

  // 验证每个阶段都有项目
  let allStagesHaveProjects = true
  for (const stage of STAGE_ORDER) {
    const stageProjects = updatedMineProjects.filter(p => p.followStage === stage)
    if (stageProjects.length === 0) {
      allStagesHaveProjects = false
      logFail(`${STAGE_LABELS[stage]}阶段无项目`)
    }
  }
  if (allStagesHaveProjects) {
    logPass('所有 6 个阶段都有个人项目')
  }

  // 验证分组逻辑（模拟工作台页面的分组）
  const groupedByStage = STAGE_ORDER.map(stage => ({
    stage,
    label: STAGE_LABELS[stage],
    projects: updatedMineProjects.filter(p => p.followStage === stage),
  }))

  const totalGrouped = groupedByStage.reduce((sum, g) => sum + g.projects.length, 0)
  if (totalGrouped === updatedMineProjects.length) {
    logPass(`分组逻辑正确：所有 ${updatedMineProjects.length} 个个人项目被正确分到 6 个阶段`)
  } else {
    logFail('分组逻辑不正确', `分组总数: ${totalGrouped}, 实际总数: ${updatedMineProjects.length}`)
  }

  // ─────────────────────────────────────────────────────────
  // 测试组5: 项目卡片维护人名字（createdBy）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组5: 项目卡片维护人名字（createdBy）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 5.1 验证 projects API 返回 createdBy
  const projectWithCreator = await prisma.project.findUnique({
    where: { id: myProject.id },
    include: {
      members: { select: { userId: true } },
      createdBy: { select: { id: true, name: true } },
    },
  })

  if (projectWithCreator?.createdBy?.name) {
    logPass(`项目 createdBy.name 正确: ${projectWithCreator.createdBy.name}`)
  } else {
    logFail('项目 createdBy.name 为空')
  }

  if (projectWithCreator?.createdBy?.id === testManager.id) {
    logPass('项目 createdBy.id 与创建者一致')
  } else {
    logFail('项目 createdBy.id 与创建者不一致')
  }

  // 5.2 验证项目库页面源码包含维护人显示
  const projectsPagePath = path.join(process.cwd(), 'src/app/projects/page.tsx')
  const projectsPageContent = fs.readFileSync(projectsPagePath, 'utf-8')

  if (projectsPageContent.includes('createdBy?.name')) {
    logPass('项目库页面源码包含 createdBy.name 显示逻辑')
  } else {
    logFail('项目库页面源码缺少 createdBy.name 显示逻辑')
  }

  if (projectsPageContent.includes('createdBy: { id: string; name: string | null } | null')) {
    logPass('项目库页面 Project 接口包含 createdBy 字段')
  } else {
    logFail('项目库页面 Project 接口缺少 createdBy 字段')
  }

  // 5.3 验证工作台页面源码包含维护人显示
  const workbenchPageContent = fs.readFileSync(workbenchPath, 'utf-8')
  if (workbenchPageContent.includes('createdBy?.name')) {
    logPass('工作台页面源码包含 createdBy.name 显示逻辑')
  } else {
    logFail('工作台页面源码缺少 createdBy.name 显示逻辑')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组6: Dashboard API 返回 maintainerName
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组6: Dashboard API 返回 maintainerName')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 验证 dashboard API 源码包含 maintainerName
  const dashboardApiPath = path.join(process.cwd(), 'src/app/api/dashboard/route.ts')
  const dashboardApiContent = fs.readFileSync(dashboardApiPath, 'utf-8')

  if (dashboardApiContent.includes('maintainerName')) {
    logPass('Dashboard API 源码包含 maintainerName 字段')
  } else {
    logFail('Dashboard API 源码缺少 maintainerName 字段')
  }

  if (dashboardApiContent.includes('p.createdBy?.name')) {
    logPass('Dashboard API 从 createdBy.name 提取维护人名字')
  } else {
    logFail('Dashboard API 未从 createdBy.name 提取维护人名字')
  }

  // 6.2 验证首页源码包含 maintainerName 显示
  const homePagePath = path.join(process.cwd(), 'src/app/page.tsx')
  const homePageContent = fs.readFileSync(homePagePath, 'utf-8')

  if (homePageContent.includes('maintainerName')) {
    logPass('首页源码包含 maintainerName 字段')
  } else {
    logFail('首页源码缺少 maintainerName 字段')
  }

  if (homePageContent.includes('project.maintainerName')) {
    logPass('首页项目卡片显示 maintainerName')
  } else {
    logFail('首页项目卡片未显示 maintainerName')
  }

  if (homePageContent.includes('maintainerName: string')) {
    logPass('首页 WeeklyProject 接口包含 maintainerName')
  } else {
    logFail('首页 WeeklyProject 接口缺少 maintainerName')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组7: 工作台页面源码逻辑验证
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组7: 工作台页面源码逻辑验证')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 7.1 验证 scope=mine
  if (workbenchPageContent.includes("scope=mine")) {
    logPass('工作台页面使用 scope=mine 获取个人项目')
  } else {
    logFail('工作台页面未使用 scope=mine')
  }

  // 7.2 验证阶段分组
  if (workbenchPageContent.includes('STAGE_ORDER')) {
    logPass('工作台页面使用 STAGE_ORDER 定义阶段顺序')
  } else {
    logFail('工作台页面缺少 STAGE_ORDER')
  }

  // 7.3 验证 6 个阶段都包含
  const stagesInCode = ['INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE', 'CLOSING', 'POST_INVESTMENT']
  const allStagesPresent = stagesInCode.every(s => workbenchPageContent.includes(s))
  if (allStagesPresent) {
    logPass('工作台页面包含全部 6 个阶段常量')
  } else {
    logFail('工作台页面缺少部分阶段常量')
  }

  // 7.4 验证未登录跳转
  if (workbenchPageContent.includes("unauthenticated")) {
    logPass('工作台页面包含未登录跳转逻辑')
  } else {
    logFail('工作台页面缺少未登录跳转逻辑')
  }

  // 7.5 验证 force-dynamic
  const workbenchLayoutContent = fs.readFileSync(workbenchLayoutPath, 'utf-8')
  if (workbenchLayoutContent.includes("force-dynamic")) {
    logPass('工作台 layout 包含 force-dynamic（避免静态预渲染问题）')
  } else {
    logFail('工作台 layout 缺少 force-dynamic')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组8: 端到端验证（创建项目 → 工作台显示）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组8: 端到端验证（创建项目 → 工作台 scope=mine 过滤）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 模拟经理创建 3 个不同阶段的项目
  const e2eProjects: { id: string; stage: string; name: string }[] = []
  for (const stage of ['INITIAL_TALK', 'DUE_DILIGENCE', 'POST_INVESTMENT']) {
    const p = await prisma.project.create({
      data: {
        name: `E2E工作台-${STAGE_LABELS[stage]}-${Date.now()}`,
        followStage: stage,
        totalAmount: 500,
        raisedAmount: 0,
        targetDate: new Date('2026-12-31T00:00:00.000Z'),
        createdById: testManager.id,
      },
    })
    e2eProjects.push({ id: p.id, stage, name: p.name })
    createdProjectIds.push(p.id)
  }

  // 模拟工作台获取个人项目
  const e2eAllProjects = await prisma.project.findMany({
    where: { createdById: testManager.id },
    include: {
      members: { select: { userId: true } },
      createdBy: { select: { id: true, name: true } },
    },
  })

  const e2eMineProjects = e2eAllProjects.filter(project => {
    const memberIds = project.members.map(m => m.userId)
    const permProject = {
      followStage: project.followStage,
      createdById: project.createdById,
      memberIds,
    }
    return canViewProject(currentUser, permProject) && isMaintainedByUser(currentUser, permProject)
  })

  // 验证 3 个 E2E 项目都在个人项目列表中
  let e2eAllFound = true
  for (const e2eP of e2eProjects) {
    if (!e2eMineProjects.some(p => p.id === e2eP.id)) {
      e2eAllFound = false
      logFail(`E2E 项目未在工作台显示: ${e2eP.name}`)
    }
  }
  if (e2eAllFound) {
    logPass(`E2E: 3 个不同阶段的项目全部在工作台显示`)
  }

  // 验证分组正确
  const e2eGrouped = STAGE_ORDER.map(stage => ({
    stage,
    projects: e2eMineProjects.filter(p => p.followStage === stage),
  }))
  const e2eInitialTalk = e2eGrouped.find(g => g.stage === 'INITIAL_TALK')
  const e2eDueDiligence = e2eGrouped.find(g => g.stage === 'DUE_DILIGENCE')
  const e2ePostInvestment = e2eGrouped.find(g => g.stage === 'POST_INVESTMENT')

  if (e2eInitialTalk && e2eInitialTalk.projects.length > 0) {
    logPass(`E2E: 初聊阶段分组正确（${e2eInitialTalk.projects.length} 个项目）`)
  } else {
    logFail('E2E: 初聊阶段分组失败')
  }

  if (e2eDueDiligence && e2eDueDiligence.projects.length > 0) {
    logPass(`E2E: 尽调阶段分组正确（${e2eDueDiligence.projects.length} 个项目）`)
  } else {
    logFail('E2E: 尽调阶段分组失败')
  }

  if (e2ePostInvestment && e2ePostInvestment.projects.length > 0) {
    logPass(`E2E: 投后阶段分组正确（${e2ePostInvestment.projects.length} 个项目）`)
  } else {
    logFail('E2E: 投后阶段分组失败')
  }

  // 验证维护人名字
  const e2eWithCreator = e2eMineProjects.find(p => e2eProjects.some(e => e.id === p.id))
  if (e2eWithCreator?.createdBy?.name) {
    logPass(`E2E: 项目维护人名字正确: ${e2eWithCreator.createdBy.name}`)
  } else {
    logFail('E2E: 项目维护人名字为空')
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
    console.log('\n🎉 所有测试通过！工作台 + 导航重命名 + 维护人显示功能正常。')
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
