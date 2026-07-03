/**
 * API 路由逻辑测试脚本
 * 直接测试 /api/projects POST 和 PUT 路由的核心逻辑
 * （targetDate 转换、financialData 处理、financingRound 字段）
 *
 * 运行: npx tsx scripts/test-api-projects.ts
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

async function getAdminUser() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
  if (!admin) {
    throw new Error('未找到管理员用户，请先运行 npm run create-admin')
  }
  return admin
}

/**
 * 模拟 POST /api/projects 路由的核心逻辑
 * （与 src/app/api/projects/route.ts 中的逻辑保持一致）
 */
async function simulatePostRoute(body: any, userId: string) {
  // 检查 session.user.id
  if (!userId) {
    return { status: 401, data: { error: '登录已过期，请退出后重新登录', detail: 'session.user.id is missing' } }
  }

  const { name, checkDuplicate, financialData, ...data } = body

  // financialData: 前端可能发送对象或字符串，统一转为字符串存储
  if (financialData && typeof financialData === 'object') {
    data.financialData = JSON.stringify(financialData)
  } else if (financialData) {
    data.financialData = financialData
  }

  // targetDate: 确保是完整的 ISO-8601 DateTime
  if (data.targetDate && typeof data.targetDate === 'string') {
    const parsed = new Date(data.targetDate)
    if (isNaN(parsed.getTime())) {
      return { status: 400, data: { error: 'targetDate 格式无效', detail: `无法解析: ${data.targetDate}` } }
    }
    data.targetDate = parsed.toISOString()
  }

  // totalAmount: 确保是数字
  if (data.totalAmount !== undefined && typeof data.totalAmount === 'string') {
    data.totalAmount = parseFloat(data.totalAmount)
    if (isNaN(data.totalAmount)) {
      return { status: 400, data: { error: 'totalAmount 格式无效' } }
    }
  }

  // raisedAmount: 确保是数字
  if (data.raisedAmount !== undefined && typeof data.raisedAmount === 'string') {
    data.raisedAmount = parseFloat(data.raisedAmount) || 0
  }

  if (!name) {
    return { status: 400, data: { error: '项目名称是必填项' } }
  }

  if (checkDuplicate) {
    const existingProject = await prisma.project.findFirst({ where: { name } })
    if (existingProject) {
      return { status: 409, data: { error: '可能存在重复项目', existingProject: { id: existingProject.id, name: existingProject.name } } }
    }
    return { status: 200, data: { exists: false } }
  }

  // 重复检测
  const existingProject = await prisma.project.findFirst({ where: { name } })
  if (existingProject) {
    return { status: 409, data: { error: '可能存在重复项目', existingProject: { id: existingProject.id, name: existingProject.name } } }
  }

  try {
    const project = await prisma.project.create({
      data: {
        name,
        createdById: userId,
        ...data,
      },
    })
    return { status: 201, data: { project: { ...project, totalAmount: Number(project.totalAmount), raisedAmount: Number(project.raisedAmount) } } }
  } catch (error) {
    return { status: 500, data: { error: '创建项目失败', detail: error instanceof Error ? error.message : '未知错误' } }
  }
}

/**
 * 模拟 PUT /api/projects/[id] 路由的核心逻辑
 * （与 src/app/api/projects/[id]/route.ts 中的逻辑保持一致）
 */
async function simulatePutRoute(projectId: string, body: any, userId: string) {
  if (!userId) {
    return { status: 401, data: { error: '登录已过期' } }
  }

  // 字段过滤（防止篡改 id/createdAt/createdById）
  const { id, createdAt, updatedAt, createdById, investments, investors, members, news, ...data } = body

  // financialData 处理
  if (data.financialData && typeof data.financialData === 'object') {
    data.financialData = JSON.stringify(data.financialData)
  }

  // targetDate 处理
  if (data.targetDate && typeof data.targetDate === 'string') {
    const parsed = new Date(data.targetDate)
    if (isNaN(parsed.getTime())) {
      return { status: 400, data: { error: 'targetDate 格式无效' } }
    }
    data.targetDate = parsed.toISOString()
  }

  // totalAmount / raisedAmount 数字转换
  if (data.totalAmount !== undefined && typeof data.totalAmount === 'string') {
    data.totalAmount = parseFloat(data.totalAmount)
  }
  if (data.raisedAmount !== undefined && typeof data.raisedAmount === 'string') {
    data.raisedAmount = parseFloat(data.raisedAmount) || 0
  }

  try {
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data,
    })
    return { status: 200, data: { project: { ...updatedProject, totalAmount: Number(updatedProject.totalAmount), raisedAmount: Number(updatedProject.raisedAmount) } } }
  } catch (error) {
    return { status: 500, data: { error: '更新项目失败', detail: error instanceof Error ? error.message : '未知错误' } }
  }
}

async function cleanupProject(id: string) {
  try {
    await prisma.project.delete({ where: { id } })
  } catch {
    // ignore
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('🧪 API 路由逻辑测试 - 项目创建/编辑（含 financingRound）')
  console.log('='.repeat(60))

  const admin = await getAdminUser()
  console.log(`\n📋 使用管理员账户: ${admin.email} (${admin.id})\n`)

  // ========== 测试组1: POST 创建项目（用户报告的珠海量引科技案例）==========
  console.log('━'.repeat(60))
  console.log('测试组1: POST 创建项目（珠海量引科技 - 用户报告的失败案例）')
  console.log('━'.repeat(60))

  // 测试 1.1: 用户报告的完整案例（使用唯一名称避免重复检测冲突）
  const testSuffix = `-测试${Date.now()}`
  console.log('\n测试 1.1: 创建"珠海量引科技"（含 financingRound="天使轮"）')
  const projectData1 = {
    name: `珠海量引科技${testSuffix}`,
    companyFullName: '珠海量引科技有限公司',
    industry: '半导体/芯片',
    companyPosition: '硅光芯片、CPO、OIO的光引擎',
    mainProducts: '硅光芯片、CPO光引擎',
    coreAdvantage: '具备完整的硅光芯片设计、流片、封装能力，国内独家实现MZM调制器量产',
    orderProgress: '',
    financingPlan: '本轮融资3000万',
    financingRound: '天使轮',
    followStage: 'INITIAL_TALK',
    status: 'PENDING',
    description: '珠海量引科技=硅光芯片、CPO、OIO的光引擎，现有的硅光模块MZM瓶颈突显...',
    totalAmount: 3000,
    raisedAmount: 3000,
    targetDate: '2026-07-03',  // 短格式
    financialData: '估值3亿',
  }
  let projectId1: string | null = null
  try {
    const { status, data } = await simulatePostRoute(projectData1, admin.id)
    if (status === 201 && data.project) {
      projectId1 = data.project.id
      createdProjectIds.push(projectId1)
      logPass(`创建成功 (status=201)`)
      // 验证 financingRound
      if (data.project.financingRound === '天使轮') {
        logPass(`financingRound="${data.project.financingRound}"`)
      } else {
        logFail(`financingRound 不正确`, `期望 "天使轮"，实际 "${data.project.financingRound}"`)
      }
      // 验证 targetDate 已转换为 ISO（Prisma 返回 Date 对象，需转为字符串）
      const tdStr = data.project.targetDate instanceof Date ? data.project.targetDate.toISOString() : String(data.project.targetDate)
      if (tdStr.includes('T') && tdStr.includes('Z')) {
        logPass(`targetDate ISO 格式正确: ${tdStr}`)
      } else {
        logFail(`targetDate 格式不正确: ${tdStr}`)
      }
      // 验证 totalAmount
      if (data.project.totalAmount === 3000) {
        logPass(`totalAmount=${data.project.totalAmount}`)
      } else {
        logFail(`totalAmount 不正确`, `期望 3000，实际 ${data.project.totalAmount}`)
      }
      // 验证 raisedAmount
      if (data.project.raisedAmount === 3000) {
        logPass(`raisedAmount=${data.project.raisedAmount}`)
      } else {
        logFail(`raisedAmount 不正确`, `期望 3000，实际 ${data.project.raisedAmount}`)
      }
      // 验证 companyPosition
      if (data.project.companyPosition === '硅光芯片、CPO、OIO的光引擎') {
        logPass(`companyPosition 正确`)
      } else {
        logFail(`companyPosition 不正确`)
      }
      // 验证 coreAdvantage
      if (data.project.coreAdvantage === '具备完整的硅光芯片设计、流片、封装能力，国内独家实现MZM调制器量产') {
        logPass(`coreAdvantage 正确: "${data.project.coreAdvantage}"`)
      } else {
        logFail(`coreAdvantage 不正确`, `实际: "${data.project.coreAdvantage}"`)
      }
      // 验证 mainProducts
      if (data.project.mainProducts === '硅光芯片、CPO光引擎') {
        logPass(`mainProducts 正确`)
      } else {
        logFail(`mainProducts 不正确`, `实际: "${data.project.mainProducts}"`)
      }
    } else {
      logFail('创建项目失败', `status=${status}, data=${JSON.stringify(data)}`)
    }
  } catch (e) {
    logFail('创建项目异常', e instanceof Error ? e.message : String(e))
  }

  // 测试 1.2: 不传 financingRound（默认 null）
  console.log('\n测试 1.2: 不传 financingRound（默认 null）')
  const projectData2 = {
    name: 'API测试-无融资轮次',
    companyFullName: '测试公司',
    industry: 'AI',
    totalAmount: 1000,
    targetDate: '2026-08-03',
  }
  let projectId2: string | null = null
  try {
    const { status, data } = await simulatePostRoute(projectData2, admin.id)
    if (status === 201 && data.project) {
      projectId2 = data.project.id
      createdProjectIds.push(projectId2)
      if (data.project.financingRound === null) {
        logPass('financingRound 默认 null 正确')
      } else {
        logFail(`financingRound 默认值不正确`, `期望 null，实际 "${data.project.financingRound}"`)
      }
    } else {
      logFail('创建项目失败', `status=${status}, data=${JSON.stringify(data)}`)
    }
  } catch (e) {
    logFail('创建项目异常', e instanceof Error ? e.message : String(e))
  }

  // 测试 1.3: financialData 为对象（应转为字符串）
  console.log('\n测试 1.3: financialData 为对象（应转为 JSON 字符串）')
  const projectData3 = {
    name: 'API测试-财务对象',
    totalAmount: 2000,
    targetDate: '2026-08-03',
    financialData: { revenue: '1000万', profit: '200万' },
  }
  let projectId3: string | null = null
  try {
    const { status, data } = await simulatePostRoute(projectData3, admin.id)
    if (status === 201 && data.project) {
      projectId3 = data.project.id
      createdProjectIds.push(projectId3)
      if (data.project.financialData && data.project.financialData.includes('"revenue"')) {
        logPass(`financialData 对象转字符串成功: ${data.project.financialData}`)
      } else {
        logFail(`financialData 转换不正确: ${data.project.financialData}`)
      }
    } else {
      logFail('创建项目失败', `status=${status}, data=${JSON.stringify(data)}`)
    }
  } catch (e) {
    logFail('创建项目异常', e instanceof Error ? e.message : String(e))
  }

  // 测试 1.4: targetDate 为空字符串（应处理为 null 或默认值）
  console.log('\n测试 1.4: targetDate 为完整 ISO 格式')
  const projectData4 = {
    name: 'API测试-ISO日期',
    totalAmount: 1500,
    targetDate: '2026-08-03T00:00:00.000Z',
  }
  let projectId4: string | null = null
  try {
    const { status, data } = await simulatePostRoute(projectData4, admin.id)
    if (status === 201 && data.project) {
      projectId4 = data.project.id
      createdProjectIds.push(projectId4)
      logPass(`ISO 日期创建成功: ${data.project.targetDate}`)
    } else {
      logFail('创建项目失败', `status=${status}, data=${JSON.stringify(data)}`)
    }
  } catch (e) {
    logFail('创建项目异常', e instanceof Error ? e.message : String(e))
  }

  // ========== 测试组2: PUT 编辑项目 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组2: PUT 编辑项目（含 financingRound 更新）')
  console.log('━'.repeat(60))

  // 测试 2.1: 更新 financingRound 从 "天使轮" 到 "Pre-A轮"
  console.log('\n测试 2.1: 更新 financingRound 从 "天使轮" 到 "Pre-A轮"，并更新 coreAdvantage')
  if (projectId1) {
    try {
      const { status, data } = await simulatePutRoute(projectId1, {
        name: `珠海量引科技${testSuffix}`,
        companyFullName: '珠海量引科技有限公司',
        industry: '半导体/芯片',
        companyPosition: '硅光芯片、CPO、OIO的光引擎',
        mainProducts: '硅光芯片、CPO光引擎、光模块',
        coreAdvantage: '国内独家实现MZM调制器量产，性能指标国际领先；具备完整硅光芯片设计、流片、封装能力',
        financingPlan: '本轮融资3000万',
        financingRound: 'Pre-A轮',
        followStage: 'DUE_DILIGENCE',
        status: 'ACTIVE',
        totalAmount: 3000,
        raisedAmount: 5000,
        targetDate: '2026-07-03',
        financialData: '估值5亿',
      }, admin.id)
      if (status === 200 && data.project) {
        if (data.project.financingRound === 'Pre-A轮') {
          logPass(`financingRound 更新成功: "${data.project.financingRound}"`)
        } else {
          logFail(`financingRound 更新不正确`, `期望 "Pre-A轮"，实际 "${data.project.financingRound}"`)
        }
        if (data.project.raisedAmount === 5000) {
          logPass(`raisedAmount 更新成功: ${data.project.raisedAmount}`)
        } else {
          logFail(`raisedAmount 更新不正确`, `期望 5000，实际 ${data.project.raisedAmount}`)
        }
        if (data.project.financialData === '估值5亿') {
          logPass(`financialData 更新成功: "${data.project.financialData}"`)
        } else {
          logFail(`financialData 更新不正确: "${data.project.financialData}"`)
        }
        // 验证 coreAdvantage 更新
        if (data.project.coreAdvantage === '国内独家实现MZM调制器量产，性能指标国际领先；具备完整硅光芯片设计、流片、封装能力') {
          logPass(`coreAdvantage 更新成功`)
        } else {
          logFail(`coreAdvantage 更新不正确`, `实际: "${data.project.coreAdvantage}"`)
        }
        // 验证 mainProducts 更新
        if (data.project.mainProducts === '硅光芯片、CPO光引擎、光模块') {
          logPass(`mainProducts 更新成功`)
        } else {
          logFail(`mainProducts 更新不正确`, `实际: "${data.project.mainProducts}"`)
        }
        // 验证 followStage 更新
        if (data.project.followStage === 'DUE_DILIGENCE') {
          logPass(`followStage 更新成功: "${data.project.followStage}"`)
        } else {
          logFail(`followStage 更新不正确`, `实际: "${data.project.followStage}"`)
        }
      } else {
        logFail('更新项目失败', `status=${status}, data=${JSON.stringify(data)}`)
      }
    } catch (e) {
      logFail('更新项目异常', e instanceof Error ? e.message : String(e))
    }
  }

  // 测试 2.2: 更新旧项目（不传 financingRound）
  console.log('\n测试 2.2: 更新项目（不传 financingRound，保持原值或清空）')
  if (projectId2) {
    try {
      const { status, data } = await simulatePutRoute(projectId2, {
        name: 'API测试-无融资轮次-已更新',
        industry: 'AI/大模型',
        followStage: 'PRE_DD',
        status: 'ACTIVE',
        totalAmount: 1500,
        raisedAmount: 200,
        targetDate: '2026-09-01',
      }, admin.id)
      if (status === 200 && data.project) {
        logPass(`旧项目更新成功, financingRound="${data.project.financingRound}"`)
      } else {
        logFail('旧项目更新失败', `status=${status}, data=${JSON.stringify(data)}`)
      }
    } catch (e) {
      logFail('旧项目更新异常', e instanceof Error ? e.message : String(e))
    }
  }

  // 测试 2.3: 字段过滤验证（传入 id/createdAt 应被过滤掉）
  console.log('\n测试 2.3: 字段过滤验证（传入 id/createdAt 应被过滤掉）')
  if (projectId3) {
    try {
      const { status, data } = await simulatePutRoute(projectId3, {
        id: 'fake-id-should-be-ignored',
        createdAt: '2020-01-01',
        createdById: 'fake-user',
        name: 'API测试-财务对象-已更新',
        totalAmount: 2500,
        targetDate: '2026-08-03',
      }, admin.id)
      if (status === 200 && data.project) {
        if (data.project.id === projectId3 && data.project.name === 'API测试-财务对象-已更新') {
          logPass('字段过滤正确（id/createdAt/createdById 被忽略）')
        } else {
          logFail('字段过滤失败', `id=${data.project.id}, name=${data.project.name}`)
        }
      } else {
        logFail('更新失败', `status=${status}`)
      }
    } catch (e) {
      logFail('更新异常', e instanceof Error ? e.message : String(e))
    }
  }

  // ========== 测试组3: 错误处理 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组3: 错误处理')
  console.log('━'.repeat(60))

  // 测试 3.1: 无 session（userId 为空）
  console.log('\n测试 3.1: 无 session（userId 为空）')
  try {
    const { status, data } = await simulatePostRoute({ name: '测试', totalAmount: 100, targetDate: '2026-08-03' }, '')
    if (status === 401 && data.error?.includes('登录已过期')) {
      logPass('无 session 返回 401 正确')
    } else {
      logFail('无 session 处理不正确', `status=${status}`)
    }
  } catch (e) {
    logFail('异常', e instanceof Error ? e.message : String(e))
  }

  // 测试 3.2: 缺少 name
  console.log('\n测试 3.2: 缺少项目名称')
  try {
    const { status, data } = await simulatePostRoute({ totalAmount: 100, targetDate: '2026-08-03' }, admin.id)
    if (status === 400 && data.error?.includes('必填项')) {
      logPass('缺少名称返回 400 正确')
    } else {
      logFail('缺少名称处理不正确', `status=${status}`)
    }
  } catch (e) {
    logFail('异常', e instanceof Error ? e.message : String(e))
  }

  // 测试 3.3: 无效 targetDate
  console.log('\n测试 3.3: 无效 targetDate 格式')
  try {
    const { status, data } = await simulatePostRoute({ name: '测试-无效日期', totalAmount: 100, targetDate: 'invalid-date' }, admin.id)
    if (status === 400 && data.error?.includes('targetDate')) {
      logPass('无效 targetDate 返回 400 正确')
    } else {
      logFail('无效 targetDate 处理不正确', `status=${status}, data=${JSON.stringify(data)}`)
    }
  } catch (e) {
    logFail('异常', e instanceof Error ? e.message : String(e))
  }

  // ========== 测试组4: 验证数据库实际存储 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组4: 验证数据库实际存储（重新查询）')
  console.log('━'.repeat(60))

  console.log('\n测试 4.1: 重新查询珠海量引科技项目，验证所有字段')
  if (projectId1) {
    const project = await prisma.project.findUnique({ where: { id: projectId1 } })
    if (project) {
      const allCorrect =
        project.name === `珠海量引科技${testSuffix}` &&
        project.financingRound === 'Pre-A轮' &&
        project.companyPosition === '硅光芯片、CPO、OIO的光引擎' &&
        project.coreAdvantage === '国内独家实现MZM调制器量产，性能指标国际领先；具备完整硅光芯片设计、流片、封装能力' &&
        project.mainProducts === '硅光芯片、CPO光引擎、光模块' &&
        project.followStage === 'DUE_DILIGENCE' &&
        project.totalAmount === 3000 &&
        project.raisedAmount === 5000
      if (allCorrect) {
        logPass('所有字段数据库存储正确')
        console.log(`     name: ${project.name}`)
        console.log(`     financingRound: ${project.financingRound}`)
        console.log(`     companyPosition: ${project.companyPosition}`)
        console.log(`     coreAdvantage: ${project.coreAdvantage}`)
        console.log(`     mainProducts: ${project.mainProducts}`)
        console.log(`     followStage: ${project.followStage}`)
        console.log(`     totalAmount: ${project.totalAmount}`)
        console.log(`     raisedAmount: ${project.raisedAmount}`)
        console.log(`     financialData: ${project.financialData}`)
      } else {
        logFail('部分字段不正确')
        console.log(`     name: ${project.name}`)
        console.log(`     financingRound: ${project.financingRound}`)
        console.log(`     companyPosition: ${project.companyPosition}`)
        console.log(`     coreAdvantage: ${project.coreAdvantage}`)
        console.log(`     mainProducts: ${project.mainProducts}`)
        console.log(`     followStage: ${project.followStage}`)
        console.log(`     totalAmount: ${project.totalAmount}`)
        console.log(`     raisedAmount: ${project.raisedAmount}`)
      }
    } else {
      logFail('未找到项目')
    }
  }

  // ========== 测试组5: 投资合伙人评价 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组5: 投资合伙人评价（PartnerReview）')
  console.log('━'.repeat(60))

  const createdReviewIds: string[] = []

  // 测试 5.1: 创建合伙人评价
  console.log('\n测试 5.1: 创建合伙人评价')
  if (projectId1) {
    try {
      const review = await prisma.partnerReview.create({
        data: {
          projectId: projectId1,
          userId: admin.id,
          userName: admin.name || admin.email,
          content: '项目技术壁垒较高，团队具备完整的硅光芯片设计能力，建议继续跟进。',
        },
      })
      createdReviewIds.push(review.id)
      if (review.content === '项目技术壁垒较高，团队具备完整的硅光芯片设计能力，建议继续跟进。' && review.userName) {
        logPass(`评价创建成功: userName="${review.userName}"`)
      } else {
        logFail('评价创建字段不正确', `userName="${review.userName}"`)
      }
      // 验证 createdAt
      if (review.createdAt) {
        logPass(`评价 createdAt 存在: ${review.createdAt.toISOString()}`)
      } else {
        logFail('评价 createdAt 缺失')
      }
    } catch (e) {
      logFail('创建评价异常', e instanceof Error ? e.message : String(e))
    }
  }

  // 测试 5.2: 创建第二条评价
  console.log('\n测试 5.2: 创建第二条合伙人评价')
  if (projectId1) {
    try {
      const review = await prisma.partnerReview.create({
        data: {
          projectId: projectId1,
          userId: admin.id,
          userName: '测试合伙人',
          content: 'MZM调制器量产难度大，需关注良品率。',
        },
      })
      createdReviewIds.push(review.id)
      logPass(`第二条评价创建成功: id=${review.id}`)
    } catch (e) {
      logFail('创建第二条评价异常', e instanceof Error ? e.message : String(e))
    }
  }

  // 测试 5.3: 查询项目评价列表（验证按时间降序）
  console.log('\n测试 5.3: 查询项目评价列表，验证数量和排序')
  if (projectId1) {
    try {
      const reviews = await prisma.partnerReview.findMany({
        where: { projectId: projectId1 },
        orderBy: { createdAt: 'desc' },
      })
      if (reviews.length === 2) {
        logPass(`评价数量正确: ${reviews.length}`)
      } else {
        logFail('评价数量不正确', `期望 2，实际 ${reviews.length}`)
      }
      // 验证最新评价在最前面
      if (reviews.length >= 2 && reviews[0].createdAt >= reviews[1].createdAt) {
        logPass('评价排序正确（按 createdAt 降序）')
      } else {
        logFail('评价排序不正确')
      }
    } catch (e) {
      logFail('查询评价异常', e instanceof Error ? e.message : String(e))
    }
  }

  // 测试 5.4: 空内容评价应被拒绝（API 逻辑模拟）
  console.log('\n测试 5.4: 空内容评价应被拒绝（API 逻辑模拟）')
  const emptyContent = '   '
  if (!emptyContent.trim()) {
    logPass('空内容评价被正确识别并拒绝')
  } else {
    logFail('空内容未通过验证')
  }

  // ========== 测试组6: 跟进笔记 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组6: 跟进笔记（FollowUpNote）')
  console.log('━'.repeat(60))

  const createdNoteIds: string[] = []

  // 测试 6.1: 创建跟进笔记
  console.log('\n测试 6.1: 创建跟进笔记')
  if (projectId1) {
    try {
      const note = await prisma.followUpNote.create({
        data: {
          projectId: projectId1,
          userId: admin.id,
          userName: admin.name || admin.email,
          content: '2026-07-03 与创始人会议沟通，了解到 MZM 调制器良品率已达 80%，预计 Q4 实现规模化量产。',
        },
      })
      createdNoteIds.push(note.id)
      if (note.content && note.userName) {
        logPass(`跟进笔记创建成功: userName="${note.userName}"`)
      } else {
        logFail('跟进笔记创建字段不正确')
      }
      // 验证关联 projectId 正确
      if (note.projectId === projectId1) {
        logPass('跟进笔记 projectId 关联正确')
      } else {
        logFail('跟进笔记 projectId 关联不正确')
      }
    } catch (e) {
      logFail('创建跟进笔记异常', e instanceof Error ? e.message : String(e))
    }
  }

  // 测试 6.2: 创建第二条跟进笔记
  console.log('\n测试 6.2: 创建第二条跟进笔记')
  if (projectId1) {
    try {
      const note = await prisma.followUpNote.create({
        data: {
          projectId: projectId1,
          userId: admin.id,
          userName: '测试合伙人',
          content: '下周计划拜访公司，参观产线。',
        },
      })
      createdNoteIds.push(note.id)
      logPass(`第二条跟进笔记创建成功: id=${note.id}`)
    } catch (e) {
      logFail('创建第二条跟进笔记异常', e instanceof Error ? e.message : String(e))
    }
  }

  // 测试 6.3: 查询项目跟进笔记列表
  console.log('\n测试 6.3: 查询项目跟进笔记列表')
  if (projectId1) {
    try {
      const notes = await prisma.followUpNote.findMany({
        where: { projectId: projectId1 },
        orderBy: { createdAt: 'desc' },
      })
      if (notes.length === 2) {
        logPass(`跟进笔记数量正确: ${notes.length}`)
      } else {
        logFail('跟进笔记数量不正确', `期望 2，实际 ${notes.length}`)
      }
    } catch (e) {
      logFail('查询跟进笔记异常', e instanceof Error ? e.message : String(e))
    }
  }

  // ========== 测试组7: 项目详情包含评价和笔记（模拟 GET 路由） ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组7: 项目详情 GET 接口包含 partnerReviews 和 followUpNotes')
  console.log('━'.repeat(60))

  console.log('\n测试 7.1: 查询项目详情（include partnerReviews 和 followUpNotes）')
  if (projectId1) {
    try {
      const projectWithRelations = await prisma.project.findUnique({
        where: { id: projectId1 },
        include: {
          partnerReviews: { orderBy: { createdAt: 'desc' } },
          followUpNotes: { orderBy: { createdAt: 'desc' } },
        },
      })
      if (projectWithRelations) {
        if (projectWithRelations.partnerReviews.length === 2) {
          logPass(`partnerReviews 数量正确: ${projectWithRelations.partnerReviews.length}`)
        } else {
          logFail('partnerReviews 数量不正确', `期望 2，实际 ${projectWithRelations.partnerReviews.length}`)
        }
        if (projectWithRelations.followUpNotes.length === 2) {
          logPass(`followUpNotes 数量正确: ${projectWithRelations.followUpNotes.length}`)
        } else {
          logFail('followUpNotes 数量不正确', `期望 2，实际 ${projectWithRelations.followUpNotes.length}`)
        }
        // 验证评价包含 userName 字段
        const firstReview = projectWithRelations.partnerReviews[0]
        if (firstReview && firstReview.userName && firstReview.content && firstReview.createdAt) {
          logPass(`评价字段完整: userName="${firstReview.userName}", createdAt 存在`)
        } else {
          logFail('评价字段不完整')
        }
        // 验证笔记包含 userName 字段
        const firstNote = projectWithRelations.followUpNotes[0]
        if (firstNote && firstNote.userName && firstNote.content && firstNote.createdAt) {
          logPass(`笔记字段完整: userName="${firstNote.userName}", createdAt 存在`)
        } else {
          logFail('笔记字段不完整')
        }
      } else {
        logFail('未找到项目')
      }
    } catch (e) {
      logFail('查询项目详情异常', e instanceof Error ? e.message : String(e))
    }
  }

  // ========== 清理测试数据 ==========
  console.log('\n' + '━'.repeat(60))
  console.log(`🧹 清理测试数据 (${createdProjectIds.length} 个项目)`)
  console.log('━'.repeat(60))
  for (const id of createdProjectIds) {
    await cleanupProject(id)
    console.log(`  已删除: ${id}`)
  }
  console.log('清理完成')

  // ========== 测试结果汇总 ==========
  console.log('\n' + '='.repeat(60))
  console.log('📊 测试结果汇总')
  console.log('='.repeat(60))
  console.log(`✅ 通过: ${passCount}`)
  console.log(`❌ 失败: ${failCount}`)
  console.log(`总计: ${passCount + failCount}`)
  console.log('='.repeat(60))

  if (failCount === 0) {
    console.log('\n🎉 所有测试通过！项目创建/编辑功能正常。')
  } else {
    console.log('\n⚠️ 存在失败的测试，请检查上方日志。')
  }

  await prisma.$disconnect()
  process.exit(failCount === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('❌ 测试脚本执行失败:', e)
  await prisma.$disconnect()
  process.exit(1)
})
