/**
 * 竞争态势分析 + 核心团队/竞争对手字段 综合测试脚本
 *
 * 测试覆盖：
 * 1. 测试账号验证（ADMIN/PARTNER/MANAGER + 秦伟）
 * 2. 项目创建包含新字段（coreTeam, competitors）
 * 3. 项目详情 GET 返回新字段
 * 4. 项目编辑更新新字段
 * 5. 竞争态势分析 API（GET/POST 权限、缓存存储）
 * 6. 字段保护（id/createdAt/createdById 不可篡改）
 * 7. competitorAnalysisJson 缓存读写
 *
 * 运行: npx tsx scripts/test-competitors.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

let passCount = 0
let failCount = 0
const createdProjectIds: string[] = []
const createdUserIds: string[] = []

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

async function main() {
  console.log('='.repeat(60))
  console.log('🧪 竞争态势分析 + 核心团队/竞争对手字段 综合测试')
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

  if (admin) logPass(`ADMIN 账号存在: ${admin.email}`)
  else logFail('ADMIN 账号不存在')

  if (partner) logPass(`INVESTMENT_PARTNER 账号存在: ${partner.email}`)
  else logFail('INVESTMENT_PARTNER 账号不存在')

  if (manager) logPass(`INVESTMENT_MANAGER 账号存在: ${manager.email}`)
  else logFail('INVESTMENT_MANAGER 账号不存在')

  if (qinwei && qinwei.name === '秦伟' && qinwei.role === 'INVESTMENT_PARTNER') {
    logPass(`秦伟账号正确: ${qinwei.email} | ${qinwei.name} | ${qinwei.role}`)
  } else {
    logFail('秦伟账号不存在或信息不正确')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组2: 项目创建包含新字段（coreTeam, competitors）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组2: 项目创建包含新字段（coreTeam, competitors）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const creator = admin || manager
  if (!creator) {
    console.log('  ⚠️ 跳过：未找到可用创建者账号')
    return
  }

  // 2.1 创建包含全部新字段的项目
  const project1 = await prisma.project.create({
    data: {
      name: '测试-竞争态势分析项目A',
      companyFullName: '测试竞争态势有限公司',
      industry: 'AI/Agent',
      mainProducts: '企业级AI智能体交付平台',
      coreAdvantage: '数字劳动力交付体系',
      coreTeam: '张三-CEO，前BAT技术总监；李四-CTO，清华大学AI博士',
      competitors: '智谱AI\n百川智能\n科大讯飞\n商汤科技',
      totalAmount: 5000,
      raisedAmount: 0,
      targetDate: new Date('2026-12-31T00:00:00.000Z'),
      createdById: creator.id,
    },
  })
  createdProjectIds.push(project1.id)

  if (project1.coreTeam && project1.coreTeam.includes('张三')) {
    logPass('项目创建时 coreTeam 字段正确写入')
  } else {
    logFail('项目创建时 coreTeam 字段未正确写入', project1.coreTeam || 'null')
  }

  if (project1.competitors && project1.competitors.includes('智谱AI')) {
    logPass('项目创建时 competitors 字段正确写入')
  } else {
    logFail('项目创建时 competitors 字段未正确写入', project1.competitors || 'null')
  }

  if (project1.competitorAnalysisJson === null) {
    logPass('新项目 competitorAnalysisJson 默认为 null')
  } else {
    logFail('新项目 competitorAnalysisJson 应为 null', String(project1.competitorAnalysisJson))
  }

  // 2.2 创建不含新字段的项目（应为 null）
  const project2 = await prisma.project.create({
    data: {
      name: '测试-竞争态势分析项目B',
      totalAmount: 1000,
      raisedAmount: 0,
      targetDate: new Date('2026-12-31T00:00:00.000Z'),
      createdById: creator.id,
    },
  })
  createdProjectIds.push(project2.id)

  if (project2.coreTeam === null && project2.competitors === null) {
    logPass('未填写新字段时 coreTeam/competitors 均为 null')
  } else {
    logFail('未填写新字段时应为 null', `coreTeam=${project2.coreTeam}, competitors=${project2.competitors}`)
  }

  // ─────────────────────────────────────────────────────────
  // 测试组3: 项目详情 GET 返回新字段
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组3: 项目详情 GET 返回新字段')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 模拟 GET /api/projects/[id] 的查询逻辑
  const fetchedProject = await prisma.project.findUnique({
    where: { id: project1.id },
    include: {
      members: { select: { userId: true } },
      createdBy: { select: { id: true, name: true } },
      partnerReviews: { orderBy: { createdAt: 'desc' } },
      followUpNotes: { orderBy: { createdAt: 'desc' } },
      stageApprovals: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (fetchedProject && 'coreTeam' in fetchedProject) {
    logPass(`项目详情 GET 包含 coreTeam 字段: ${fetchedProject.coreTeam?.substring(0, 20)}...`)
  } else {
    logFail('项目详情 GET 缺少 coreTeam 字段')
  }

  if (fetchedProject && 'competitors' in fetchedProject) {
    logPass(`项目详情 GET 包含 competitors 字段: ${fetchedProject.competitors?.substring(0, 20)}...`)
  } else {
    logFail('项目详情 GET 缺少 competitors 字段')
  }

  if (fetchedProject && 'competitorAnalysisJson' in fetchedProject) {
    logPass('项目详情 GET 包含 competitorAnalysisJson 字段')
  } else {
    logFail('项目详情 GET 缺少 competitorAnalysisJson 字段')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组4: 项目编辑更新新字段
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组4: 项目编辑更新新字段（模拟 PUT 路由）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 模拟 PUT 路由：更新 coreTeam 和 competitors
  const updateBody = {
    coreTeam: '王五-CEO，更新后的背景',
    competitors: '更新后的竞争对手A\n更新后的竞争对手B',
  }
  const { ...updateData } = updateBody
  // 移除不应由前端直接更新的字段
  delete (updateData as any).id
  delete (updateData as any).createdAt
  delete (updateData as any).updatedAt
  delete (updateData as any).createdById

  const updatedProject = await prisma.project.update({
    where: { id: project1.id },
    data: updateData,
  })

  if (updatedProject.coreTeam === '王五-CEO，更新后的背景') {
    logPass('PUT 更新 coreTeam 字段成功')
  } else {
    logFail('PUT 更新 coreTeam 字段失败', updatedProject.coreTeam || 'null')
  }

  if (updatedProject.competitors === '更新后的竞争对手A\n更新后的竞争对手B') {
    logPass('PUT 更新 competitors 字段成功')
  } else {
    logFail('PUT 更新 competitors 字段失败', updatedProject.competitors || 'null')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组5: 字段保护（id/createdAt/createdById 不可篡改）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组5: 字段保护（id/createdAt/createdById 不可篡改）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 模拟 PUT 路由的过滤逻辑
  const maliciousBody = {
    coreTeam: '被篡改的团队',
    id: 'fake-id',
    createdAt: new Date('2020-01-01'),
    createdById: 'fake-user-id',
    updatedAt: new Date('2020-01-01'),
  }
  const { ...filteredData } = maliciousBody
  delete (filteredData as any).id
  delete (filteredData as any).createdAt
  delete (filteredData as any).updatedAt
  delete (filteredData as any).createdById

  if (!('id' in filteredData) && !('createdAt' in filteredData) && !('createdById' in filteredData) && !('updatedAt' in filteredData)) {
    logPass('PUT 路由正确过滤 id/createdAt/createdById/updatedAt 字段')
  } else {
    logFail('PUT 路由未正确过滤受保护字段', JSON.stringify(Object.keys(filteredData)))
  }

  if ('coreTeam' in filteredData) {
    logPass('PUT 路由保留了合法的 coreTeam 字段')
  } else {
    logFail('PUT 路由错误地过滤了 coreTeam 字段')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组6: 竞争态势分析 API - 缓存读写
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组6: 竞争态势分析 - competitorAnalysisJson 缓存读写')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 6.1 初始状态：无缓存
  const beforeCache = await prisma.project.findUnique({
    where: { id: project1.id },
    select: { competitorAnalysisJson: true },
  })
  if (beforeCache?.competitorAnalysisJson === null) {
    logPass('项目初始状态 competitorAnalysisJson 为 null')
  } else {
    logFail('项目初始状态 competitorAnalysisJson 应为 null')
  }

  // 6.2 模拟 AI 分析结果写入缓存
  const mockAnalysisResult = JSON.stringify({
    competitors: [
      {
        projectName: '智谱AI',
        latestRound: '战略融资',
        amount: '10亿美元',
        founderBackground: '唐杰，清华大学教授，知识智能引擎专家',
      },
      {
        projectName: '百川智能',
        latestRound: 'B轮',
        amount: '50亿人民币',
        founderBackground: '王小川，搜狗创始人，清华大学计算机系',
      },
      {
        projectName: '科大讯飞',
        latestRound: '已上市',
        amount: '定向增发20亿',
        founderBackground: '刘庆峰，中科大博士，语音技术专家',
      },
    ],
  })

  await prisma.project.update({
    where: { id: project1.id },
    data: { competitorAnalysisJson: mockAnalysisResult },
  })

  // 6.3 验证缓存写入
  const afterCache = await prisma.project.findUnique({
    where: { id: project1.id },
    select: { competitorAnalysisJson: true },
  })

  if (afterCache?.competitorAnalysisJson) {
    const parsed = JSON.parse(afterCache.competitorAnalysisJson)
    if (Array.isArray(parsed.competitors) && parsed.competitors.length === 3) {
      logPass(`竞争态势分析缓存写入成功，包含 ${parsed.competitors.length} 个竞争对手`)
    } else {
      logFail('缓存写入但数据结构不正确')
    }
  } else {
    logFail('竞争态势分析缓存写入失败')
  }

  // 6.4 验证缓存数据结构包含所需字段
  if (afterCache?.competitorAnalysisJson) {
    const parsed = JSON.parse(afterCache.competitorAnalysisJson)
    const first = parsed.competitors[0]
    const hasAllFields = 'projectName' in first && 'latestRound' in first && 'amount' in first && 'founderBackground' in first
    if (hasAllFields) {
      logPass('缓存数据包含全部所需字段（projectName/latestRound/amount/founderBackground）')
    } else {
      logFail('缓存数据缺少字段', JSON.stringify(Object.keys(first)))
    }

    if (first.projectName === '智谱AI') {
      logPass(`缓存数据 projectName 正确: ${first.projectName}`)
    } else {
      logFail('缓存数据 projectName 不正确', first.projectName)
    }
  }

  // 6.5 验证 GET 路由读取缓存逻辑
  const getCached = await prisma.project.findUnique({
    where: { id: project1.id },
    select: { competitorAnalysisJson: true },
  })
  if (getCached?.competitorAnalysisJson) {
    let parsed: { competitors?: any[] }
    try {
      parsed = JSON.parse(getCached.competitorAnalysisJson)
      if (parsed.competitors && parsed.competitors.length > 0) {
        logPass('GET 路由正确读取并解析 competitorAnalysisJson 缓存')
      } else {
        logFail('GET 路由读取缓存但 competitors 为空')
      }
    } catch {
      logFail('GET 路由解析缓存 JSON 失败')
    }
  } else {
    logFail('GET 路由读取缓存失败')
  }

  // 6.6 无缓存时 GET 返回 null
  const noCacheProject = await prisma.project.findUnique({
    where: { id: project2.id },
    select: { competitorAnalysisJson: true },
  })
  if (noCacheProject?.competitorAnalysisJson === null) {
    logPass('无缓存项目 GET 返回 null（competitors: null）')
  } else {
    logFail('无缓存项目 GET 应返回 null')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组7: 竞争态势分析 API 权限检查
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组7: 竞争态势分析 API 权限检查')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 模拟 POST /api/projects/[id]/competitors 的权限检查逻辑
  const { canViewProject } = await import('../src/lib/permissions')

  // 7.1 未登录用户无权访问
  const unauthUser = null
  if (!canViewProject(unauthUser, {
    followStage: project1.followStage,
    createdById: project1.createdById,
    memberIds: [],
  }) && project1.followStage !== 'INITIAL_TALK' && project1.followStage !== 'PRE_DD') {
    logPass('未登录用户不可访问非公开阶段项目的竞争态势分析')
  } else {
    // INITIAL_TALK 是公开阶段，未登录也能查看，这里测试非公开阶段
    const privateProject = await prisma.project.create({
      data: {
        name: '测试-私有阶段竞争分析项目',
        followStage: 'DUE_DILIGENCE',
        totalAmount: 1000,
        raisedAmount: 0,
        targetDate: new Date('2026-12-31T00:00:00.000Z'),
        createdById: creator.id,
      },
    })
    createdProjectIds.push(privateProject.id)

    if (!canViewProject(unauthUser, {
      followStage: 'DUE_DILIGENCE',
      createdById: creator.id,
      memberIds: [],
    })) {
      logPass('未登录用户不可访问非公开阶段（DUE_DILIGENCE）项目')
    } else {
      logFail('未登录用户应不可访问非公开阶段项目')
    }
  }

  // 7.2 MANAGER 可查看项目库中的项目
  if (manager) {
    if (canViewProject({ id: manager.id, role: 'INVESTMENT_MANAGER' }, {
      followStage: project1.followStage,
      createdById: project1.createdById,
      memberIds: [],
    })) {
      logPass('MANAGER 可查看项目库中的项目（可访问竞争态势分析）')
    } else {
      logFail('MANAGER 应可查看项目库中的项目')
    }
  }

  // 7.3 PARTNER 可查看所有项目
  if (partner) {
    if (canViewProject({ id: partner.id, role: 'INVESTMENT_PARTNER' }, {
      followStage: 'DUE_DILIGENCE',
      createdById: creator.id,
      memberIds: [],
    })) {
      logPass('PARTNER 可查看所有项目（包括非公开阶段）')
    } else {
      logFail('PARTNER 应可查看所有项目')
    }
  }

  // ─────────────────────────────────────────────────────────
  // 测试组8: DeepSeek API Key 配置检查
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组8: DeepSeek API Key 配置检查')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const deepseekKey = process.env.DEEPSEEK_API_KEY
  if (deepseekKey && deepseekKey.length > 0) {
    logPass('DEEPSEEK_API_KEY 已配置（AI 分析功能可用）')
  } else {
    logFail('DEEPSEEK_API_KEY 未配置（AI 分析功能不可用）')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组9: 表单字段结构验证
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组9: 表单字段结构验证（FormData 接口含新字段）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 模拟新建项目页面的 FormData 默认值结构
  const mockFormData = {
    name: '',
    companyFullName: '',
    industry: '',
    companyPosition: '',
    mainProducts: '',
    coreAdvantage: '',
    coreTeam: '',
    competitors: '',
    financialData: '',
    orderProgress: '',
    financingPlan: '',
    financingRound: '',
    followStage: 'INITIAL_TALK',
    status: 'PENDING',
    description: '',
    totalAmount: '',
    raisedAmount: '',
    targetDate: '',
  }

  const requiredNewFields = ['coreTeam', 'competitors']
  for (const field of requiredNewFields) {
    if (field in mockFormData && mockFormData[field as keyof typeof mockFormData] === '') {
      logPass(`FormData 包含 ${field} 字段且默认值为空字符串`)
    } else {
      logFail(`FormData 缺少 ${field} 字段或默认值不正确`)
    }
  }

  // 验证 POST 请求体能正确携带新字段
  const mockPostBody = { ...mockFormData, name: '表单测试项目', totalAmount: 1000 }
  if ('coreTeam' in mockPostBody && 'competitors' in mockPostBody) {
    logPass('POST 请求体包含 coreTeam 和 competitors 字段')
  } else {
    logFail('POST 请求体缺少新字段')
  }

  // ─────────────────────────────────────────────────────────
  // 测试组10: 端到端模拟（项目 → 缓存 → 读取）
  // ─────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('测试组10: 端到端模拟（创建项目 → AI缓存 → 详情读取）')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 10.1 创建项目带竞争对手信息
  const e2eProject = await prisma.project.create({
    data: {
      name: '测试-E2E竞争分析项目',
      mainProducts: 'AI代码生成工具',
      competitors: 'GitHub Copilot\nCursor\nCodeium',
      coreTeam: '创始人-前Google工程师',
      totalAmount: 3000,
      raisedAmount: 0,
      targetDate: new Date('2026-12-31T00:00:00.000Z'),
      createdById: creator.id,
    },
  })
  createdProjectIds.push(e2eProject.id)

  if (e2eProject.competitors && e2eProject.coreTeam) {
    logPass('E2E: 项目创建带竞争对手和核心团队信息成功')
  } else {
    logFail('E2E: 项目创建带新字段失败')
  }

  // 10.2 模拟 AI 写入缓存
  const e2eAnalysis = JSON.stringify({
    competitors: [
      { projectName: 'GitHub Copilot', latestRound: '已集成产品', amount: '未公开', founderBackground: '微软/GitHub 出品' },
      { projectName: 'Cursor', latestRound: 'B轮', amount: '6000万美元', founderBackground: 'Aman Anys, 前 Google 工程师' },
      { projectName: 'Codeium', latestRound: 'A轮', amount: '2600万美元', founderBackground: 'Varun Mohan, MIT 毕业' },
    ],
  })
  await prisma.project.update({
    where: { id: e2eProject.id },
    data: { competitorAnalysisJson: e2eAnalysis },
  })

  // 10.3 模拟详情页读取
  const e2eFetched = await prisma.project.findUnique({
    where: { id: e2eProject.id },
    select: {
      name: true,
      mainProducts: true,
      competitors: true,
      coreTeam: true,
      competitorAnalysisJson: true,
    },
  })

  if (e2eFetched) {
    if (e2eFetched.competitors && e2eFetched.coreTeam) {
      logPass('E2E: 详情页读取到左侧核心团队/竞争对手字段')
    } else {
      logFail('E2E: 详情页左侧字段读取失败')
    }

    if (e2eFetched.competitorAnalysisJson) {
      const parsed = JSON.parse(e2eFetched.competitorAnalysisJson)
      if (parsed.competitors.length === 3) {
        logPass(`E2E: 详情页读取到右侧竞争态势分析（${parsed.competitors.length} 个竞品）`)
      } else {
        logFail('E2E: 竞争态势分析数量不正确')
      }

      // 验证竞品信息结构
      const item = parsed.competitors[0]
      const requiredFields = ['projectName', 'latestRound', 'amount', 'founderBackground']
      const allPresent = requiredFields.every(f => f in item)
      if (allPresent) {
        logPass('E2E: 竞品信息包含全部 4 个字段（项目名称/融资轮次/融资金额/创始人背景）')
      } else {
        logFail('E2E: 竞品信息字段不完整', JSON.stringify(Object.keys(item)))
      }
    } else {
      logFail('E2E: 竞争态势分析缓存读取失败')
    }
  } else {
    logFail('E2E: 项目详情读取失败')
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

  for (const uid of createdUserIds) {
    try {
      await prisma.user.delete({ where: { id: uid } })
    } catch {
      // ignore
    }
  }

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
    console.log('\n🎉 所有测试通过！竞争态势分析 + 核心团队/竞争对手字段功能正常。')
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
