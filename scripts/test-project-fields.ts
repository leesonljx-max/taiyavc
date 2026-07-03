/**
 * 项目新字段测试脚本
 * 测试 financingRound（融资轮次）和 raisedAmount（历史累计融资金额）字段
 * 运行: npx tsx scripts/test-project-fields.ts
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

function logFail(msg: string, error?: unknown) {
  console.log(`  ❌ FAIL: ${msg}`)
  if (error instanceof Error) {
    console.log(`     错误: ${error.message}`)
  }
  failCount++
}

async function getAdminUser() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
  if (!admin) {
    throw new Error('未找到管理员用户，请先运行 npm run create-admin')
  }
  return admin
}

async function cleanupProject(id: string) {
  try {
    await prisma.project.delete({ where: { id } })
  } catch {
    // ignore
  }
}

/**
 * 模拟周报解析中的融资轮次提取
 */
function parseFinancingRound(text: string): string | undefined {
  const roundMatch = text.match(/(天使轮|Pre-A轮|Pre-A|A\+轮|A轮|A1轮|B轮|C轮|D轮|E轮|Pre-IPO|战略融资)/)
  if (roundMatch) {
    let round = roundMatch[1]
    if (round === 'Pre-A') round = 'Pre-A轮'
    return round
  }
  return undefined
}

async function main() {
  console.log('='.repeat(60))
  console.log('🧪 项目新字段测试 - 开始')
  console.log('='.repeat(60))

  const admin = await getAdminUser()
  console.log(`\n📋 使用管理员账户: ${admin.email} (${admin.id})\n`)

  // ========== 测试组1: financingRound 数据库存储 ==========
  console.log('━'.repeat(60))
  console.log('测试组1: financingRound 数据库存储')
  console.log('━'.repeat(60))

  // 测试 1.1: financingRound 为 "Pre-A轮"
  console.log('\n测试 1.1: financingRound = "Pre-A轮"')
  try {
    const project = await prisma.project.create({
      data: {
        name: '测试-融资轮次PreA',
        createdById: admin.id,
        totalAmount: 1000,
        targetDate: new Date('2026-08-03').toISOString(),
        followStage: 'INITIAL_TALK',
        financingRound: 'Pre-A轮',
      },
    })
    createdProjectIds.push(project.id)
    if (project.financingRound === 'Pre-A轮') {
      logPass(`financingRound 存储成功: "${project.financingRound}"`)
    } else {
      logFail(`financingRound 异常，期望 "Pre-A轮"，实际 "${project.financingRound}"`)
    }
  } catch (error) {
    logFail('financingRound Pre-A轮 创建失败', error)
  }

  // 测试 1.2: financingRound 为 "天使轮"
  console.log('\n测试 1.2: financingRound = "天使轮"')
  try {
    const project = await prisma.project.create({
      data: {
        name: '测试-融资轮次天使',
        createdById: admin.id,
        totalAmount: 500,
        targetDate: new Date('2026-08-03').toISOString(),
        followStage: 'INITIAL_TALK',
        financingRound: '天使轮',
      },
    })
    createdProjectIds.push(project.id)
    if (project.financingRound === '天使轮') {
      logPass(`financingRound 存储成功: "${project.financingRound}"`)
    } else {
      logFail(`financingRound 异常，期望 "天使轮"，实际 "${project.financingRound}"`)
    }
  } catch (error) {
    logFail('financingRound 天使轮 创建失败', error)
  }

  // 测试 1.3: financingRound 为 null
  console.log('\n测试 1.3: financingRound = null')
  try {
    const project = await prisma.project.create({
      data: {
        name: '测试-融资轮次Null',
        createdById: admin.id,
        totalAmount: 800,
        targetDate: new Date('2026-08-03').toISOString(),
        followStage: 'INITIAL_TALK',
        financingRound: null,
      },
    })
    createdProjectIds.push(project.id)
    if (project.financingRound === null) {
      logPass('financingRound null 存储成功')
    } else {
      logFail(`financingRound 异常，期望 null，实际 "${project.financingRound}"`)
    }
  } catch (error) {
    logFail('financingRound null 创建失败', error)
  }

  // 测试 1.4: 不传 financingRound（应为 null）
  console.log('\n测试 1.4: 不传 financingRound（默认值应为 null）')
  try {
    const project = await prisma.project.create({
      data: {
        name: '测试-融资轮次默认',
        createdById: admin.id,
        totalAmount: 1200,
        targetDate: new Date('2026-08-03').toISOString(),
        followStage: 'INITIAL_TALK',
      },
    })
    createdProjectIds.push(project.id)
    if (project.financingRound === null) {
      logPass('financingRound 默认 null 正确')
    } else {
      logFail(`financingRound 默认值异常，期望 null，实际 "${project.financingRound}"`)
    }
  } catch (error) {
    logFail('financingRound 默认值创建失败', error)
  }

  // ========== 测试组2: raisedAmount 历史累计融资金额 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组2: raisedAmount 历史累计融资金额')
  console.log('━'.repeat(60))

  // 测试 2.1: raisedAmount 为指定值
  console.log('\n测试 2.1: raisedAmount = 3000')
  try {
    const project = await prisma.project.create({
      data: {
        name: '测试-历史累计融资',
        createdById: admin.id,
        totalAmount: 2000,
        raisedAmount: 3000,
        targetDate: new Date('2026-08-03').toISOString(),
        followStage: 'DUE_DILIGENCE',
        financingRound: 'A轮',
      },
    })
    createdProjectIds.push(project.id)
    if (project.raisedAmount === 3000) {
      logPass(`raisedAmount 存储成功: ${project.raisedAmount}`)
    } else {
      logFail(`raisedAmount 异常，期望 3000，实际 ${project.raisedAmount}`)
    }
  } catch (error) {
    logFail('raisedAmount 创建失败', error)
  }

  // 测试 2.2: raisedAmount 默认值为 0
  console.log('\n测试 2.2: raisedAmount 默认值为 0')
  try {
    const project = await prisma.project.create({
      data: {
        name: '测试-历史累计默认0',
        createdById: admin.id,
        totalAmount: 1500,
        targetDate: new Date('2026-08-03').toISOString(),
        followStage: 'INITIAL_TALK',
      },
    })
    createdProjectIds.push(project.id)
    if (project.raisedAmount === 0) {
      logPass(`raisedAmount 默认值正确: ${project.raisedAmount}`)
    } else {
      logFail(`raisedAmount 默认值异常，期望 0，实际 ${project.raisedAmount}`)
    }
  } catch (error) {
    logFail('raisedAmount 默认值创建失败', error)
  }

  // ========== 测试组3: 完整项目创建（所有新字段）==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组3: 完整项目创建（financingRound + raisedAmount + companyPosition）')
  console.log('━'.repeat(60))

  console.log('\n测试 3.1: 创建包含所有新字段的项目')
  try {
    const project = await prisma.project.create({
      data: {
        name: '北京太忆科技',
        companyFullName: '北京太忆科技有限公司',
        industry: 'AI/Agent',
        companyPosition: 'Agent 基础记忆体小脑模型',
        mainProducts: '记忆一体机',
        financingRound: '天使轮',
        financingPlan: '本轮融资2000万',
        totalAmount: 2000,
        raisedAmount: 500,
        targetDate: new Date('2026-08-03').toISOString(),
        followStage: 'DUE_DILIGENCE',
        status: 'PENDING',
        financialData: '估值1.5亿',
        createdById: admin.id,
      },
    })
    createdProjectIds.push(project.id)

    const allFieldsCorrect =
      project.name === '北京太忆科技' &&
      project.companyPosition === 'Agent 基础记忆体小脑模型' &&
      project.financingRound === '天使轮' &&
      project.totalAmount === 2000 &&
      project.raisedAmount === 500

    if (allFieldsCorrect) {
      logPass('所有字段存储正确')
      console.log(`     name: ${project.name}`)
      console.log(`     companyPosition: ${project.companyPosition}`)
      console.log(`     financingRound: ${project.financingRound}`)
      console.log(`     totalAmount(融资金额): ${project.totalAmount}`)
      console.log(`     raisedAmount(历史累计): ${project.raisedAmount}`)
    } else {
      logFail('部分字段不正确')
      console.log(`     name: ${project.name}`)
      console.log(`     companyPosition: ${project.companyPosition}`)
      console.log(`     financingRound: ${project.financingRound}`)
      console.log(`     totalAmount: ${project.totalAmount}`)
      console.log(`     raisedAmount: ${project.raisedAmount}`)
    }
  } catch (error) {
    logFail('完整项目创建失败', error)
  }

  // ========== 测试组4: 周报解析融资轮次 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组4: 周报解析融资轮次')
  console.log('━'.repeat(60))

  const roundTestCases: Array<[string, string | undefined]> = [
    ['本轮融资2000万，Pre-A轮', 'Pre-A轮'],
    ['天使轮融资500万', '天使轮'],
    ['完成A轮融资', 'A轮'],
    ['正在进行B轮融资', 'B轮'],
    ['Pre-IPO轮融资', 'Pre-IPO'],
    ['战略融资', '战略融资'],
    ['融资1000万，无轮次信息', undefined],
  ]

  for (const [text, expected] of roundTestCases) {
    console.log(`\n测试: "${text}"`)
    const result = parseFinancingRound(text)
    if (result === expected) {
      logPass(`解析正确: "${result}"`)
    } else {
      logFail(`解析异常，期望 "${expected}"，实际 "${result}"`)
    }
  }

  // ========== 测试组5: 更新 financingRound ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组5: 更新 financingRound（模拟编辑项目）')
  console.log('━'.repeat(60))

  console.log('\n测试 5.1: 更新 financingRound 从 null 到 "B轮"')
  try {
    // 先创建一个没有 financingRound 的项目
    const project = await prisma.project.create({
      data: {
        name: '测试-更新融资轮次',
        createdById: admin.id,
        totalAmount: 3000,
        targetDate: new Date('2026-08-03').toISOString(),
        followStage: 'INITIAL_TALK',
      },
    })
    createdProjectIds.push(project.id)

    // 更新 financingRound
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: { financingRound: 'B轮', raisedAmount: 8000 },
    })

    if (updated.financingRound === 'B轮' && updated.raisedAmount === 8000) {
      logPass(`更新成功: financingRound="${updated.financingRound}", raisedAmount=${updated.raisedAmount}`)
    } else {
      logFail(`更新异常: financingRound="${updated.financingRound}", raisedAmount=${updated.raisedAmount}`)
    }
  } catch (error) {
    logFail('更新 financingRound 失败', error)
  }

  // ========== 清理测试数据 ==========
  console.log('\n' + '━'.repeat(60))
  console.log(`🧹 清理测试数据 (${createdProjectIds.length} 个项目)`)
  console.log('━'.repeat(60))
  for (const id of createdProjectIds) {
    await cleanupProject(id)
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
    console.log('\n🎉 所有测试通过！新字段功能正常。')
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
