/**
 * 项目创建测试脚本
 * 测试各种数据格式下 Prisma 创建项目的兼容性
 * 运行: npx tsx scripts/test-create-project.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface TestCase {
  name: string
  description: string
  data: () => Promise<any>
  shouldSucceed: boolean
}

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

/**
 * 模拟 API 路由中的 targetDate 转换逻辑
 */
function convertTargetDate(targetDate: any): string {
  if (targetDate) {
    const d = new Date(targetDate)
    if (isNaN(d.getTime())) {
      throw new Error(`目标日期格式无效: ${targetDate}`)
    }
    return d.toISOString()
  }
  return new Date().toISOString()
}

/**
 * 模拟 API 路由中的 financialData 转换逻辑
 */
function convertFinancialData(financialData: any): string | undefined {
  if (financialData && typeof financialData === 'object') {
    return JSON.stringify(financialData)
  } else if (financialData) {
    return financialData
  }
  return undefined
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
  console.log('🧪 项目创建测试 - 开始')
  console.log('='.repeat(60))

  const admin = await getAdminUser()
  console.log(`\n📋 使用管理员账户: ${admin.email} (${admin.id})\n`)

  // ========== 测试组1: targetDate 各种格式 ==========
  console.log('━'.repeat(60))
  console.log('测试组1: targetDate 各种格式')
  console.log('━'.repeat(60))

  // 测试 1.1: 短日期格式 "2026-08-03" (HTML date input 默认格式)
  console.log('\n测试 1.1: 短日期格式 "2026-08-03"（HTML date input 默认）')
  try {
    const rawDate = '2026-08-03'
    const isoDate = convertTargetDate(rawDate)
    const project = await prisma.project.create({
      data: {
        name: '测试项目-短日期格式',
        createdById: admin.id,
        totalAmount: 1000,
        targetDate: isoDate,
        followStage: 'INITIAL_TALK',
      },
    })
    createdProjectIds.push(project.id)
    logPass(`创建成功，targetDate 存储为: ${project.targetDate.toISOString()}`)
    if (project.targetDate.toISOString() === '2026-08-03T00:00:00.000Z') {
      logPass('日期转换正确: "2026-08-03" → "2026-08-03T00:00:00.000Z"')
    } else {
      logFail(`日期转换异常，期望 2026-08-03T00:00:00.000Z，实际 ${project.targetDate.toISOString()}`)
    }
  } catch (error) {
    logFail('短日期格式创建失败', error)
  }

  // 测试 1.2: 完整 ISO 格式
  console.log('\n测试 1.2: 完整 ISO 格式 "2026-08-03T00:00:00.000Z"')
  try {
    const project = await prisma.project.create({
      data: {
        name: '测试项目-完整ISO',
        createdById: admin.id,
        totalAmount: 2000,
        targetDate: new Date('2026-08-03T00:00:00.000Z'),
        followStage: 'INITIAL_TALK',
      },
    })
    createdProjectIds.push(project.id)
    logPass(`创建成功，targetDate: ${project.targetDate.toISOString()}`)
  } catch (error) {
    logFail('完整ISO格式创建失败', error)
  }

  // 测试 1.3: 直接传短日期字符串（模拟未转换的 bug 场景）
  console.log('\n测试 1.3: 直接传短日期字符串（模拟未转换的 bug 场景）')
  try {
    const project = await prisma.project.create({
      data: {
        name: '测试项目-未转换短日期',
        createdById: admin.id,
        totalAmount: 3000,
        targetDate: '2026-08-03' as any, // 故意传字符串
        followStage: 'INITIAL_TALK',
      },
    } as any)
    createdProjectIds.push(project.id)
    logPass(`意外成功，targetDate: ${project.targetDate}`)
    logFail('Prisma 应该拒绝短日期字符串，但接受了')
  } catch (error) {
    logPass(`正确拒绝短日期字符串: ${error instanceof Error ? error.message.split('\n')[0] : ''}`)
  }

  // 测试 1.4: 空日期
  console.log('\n测试 1.4: 空日期（应使用默认值）')
  try {
    const isoDate = convertTargetDate(undefined)
    const project = await prisma.project.create({
      data: {
        name: '测试项目-空日期默认值',
        createdById: admin.id,
        totalAmount: 4000,
        targetDate: isoDate,
        followStage: 'INITIAL_TALK',
      },
    })
    createdProjectIds.push(project.id)
    logPass(`创建成功，使用默认日期: ${project.targetDate.toISOString()}`)
  } catch (error) {
    logFail('空日期创建失败', error)
  }

  // ========== 测试组2: financialData 各种格式 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组2: financialData 各种格式')
  console.log('━'.repeat(60))

  // 测试 2.1: financialData 为对象
  console.log('\n测试 2.1: financialData 为对象（应转为 JSON 字符串）')
  try {
    const finObj = { revenue: 1000, profit: 200, year: 2025 }
    const finStr = convertFinancialData(finObj)
    const project = await prisma.project.create({
      data: {
        name: '测试项目-financialData对象',
        createdById: admin.id,
        totalAmount: 5000,
        targetDate: new Date('2026-08-03').toISOString(),
        followStage: 'INITIAL_TALK',
        financialData: finStr,
      },
    })
    createdProjectIds.push(project.id)
    if (project.financialData === JSON.stringify(finObj)) {
      logPass(`对象转字符串成功: ${project.financialData}`)
    } else {
      logFail(`转换异常，期望 ${JSON.stringify(finObj)}，实际 ${project.financialData}`)
    }
  } catch (error) {
    logFail('financialData 对象创建失败', error)
  }

  // 测试 2.2: financialData 为纯文本字符串（如 "1000万"）
  console.log('\n测试 2.2: financialData 为纯文本字符串 "1000万"')
  try {
    const finStr = convertFinancialData('1000万')
    const project = await prisma.project.create({
      data: {
        name: '测试项目-financialData文本',
        createdById: admin.id,
        totalAmount: 6000,
        targetDate: new Date('2026-08-03').toISOString(),
        followStage: 'INITIAL_TALK',
        financialData: finStr,
      },
    })
    createdProjectIds.push(project.id)
    if (project.financialData === '1000万') {
      logPass(`纯文本存储成功: ${project.financialData}`)
    } else {
      logFail(`存储异常，期望 "1000万"，实际 "${project.financialData}"`)
    }
  } catch (error) {
    logFail('financialData 纯文本创建失败', error)
  }

  // 测试 2.3: financialData 为 null
  console.log('\n测试 2.3: financialData 为 null')
  try {
    const project = await prisma.project.create({
      data: {
        name: '测试项目-financialDataNull',
        createdById: admin.id,
        totalAmount: 7000,
        targetDate: new Date('2026-08-03').toISOString(),
        followStage: 'INITIAL_TALK',
        financialData: null,
      },
    })
    createdProjectIds.push(project.id)
    logPass(`null 值创建成功`)
  } catch (error) {
    logFail('financialData null 创建失败', error)
  }

  // ========== 测试组3: 模拟前端提交的真实场景 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组3: 模拟前端真实提交场景（复现用户报告的 bug）')
  console.log('━'.repeat(60))

  // 测试 3.1: 复现用户报告的 bug（信人智能）
  console.log('\n测试 3.1: 复现用户报告的 bug（信人智能 - targetDate 短格式）')
  try {
    const rawBody = {
      name: '信人智能-测试',
      companyFullName: '南京信人智能科技有限公司',
      industry: 'AI硬件',
      companyPosition: 'AI决策外脑',
      mainProducts: 'P2/R1',
      orderProgress: '1.3万',
      financingPlan: '',
      followStage: 'DUE_DILIGENCE',
      status: 'PENDING',
      description: '',
      totalAmount: 4997,
      targetDate: '2026-08-03', // 这是 bug 触发的格式
      financialData: '1000万',
    }

    // 模拟 API 路由的处理逻辑
    const { name, financialData, targetDate, ...data } = rawBody
    const convertedFinancial = convertFinancialData(financialData)
    const convertedDate = convertTargetDate(targetDate)

    const project = await prisma.project.create({
      data: {
        name,
        createdById: admin.id,
        ...data,
        financialData: convertedFinancial,
        targetDate: convertedDate,
      } as any,
    })
    createdProjectIds.push(project.id)
    logPass(`复现场景创建成功！targetDate: ${project.targetDate.toISOString()}, financialData: ${project.financialData}`)
  } catch (error) {
    logFail('复现场景创建失败', error)
  }

  // 测试 3.2: totalAmount 为字符串
  console.log('\n测试 3.2: totalAmount 为字符串 "4997"')
  try {
    const project = await prisma.project.create({
      data: {
        name: '测试项目-totalAmount字符串',
        createdById: admin.id,
        totalAmount: Number('4997'),
        targetDate: new Date('2026-08-03').toISOString(),
        followStage: 'INITIAL_TALK',
      },
    })
    createdProjectIds.push(project.id)
    if (project.totalAmount === 4997) {
      logPass(`totalAmount 转换成功: ${project.totalAmount}`)
    } else {
      logFail(`totalAmount 异常，期望 4997，实际 ${project.totalAmount}`)
    }
  } catch (error) {
    logFail('totalAmount 字符串创建失败', error)
  }

  // ========== 测试组4: 错误输入验证 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组4: 错误输入验证')
  console.log('━'.repeat(60))

  // 测试 4.1: 无效日期
  console.log('\n测试 4.1: 无效日期 "not-a-date"')
  try {
    convertTargetDate('not-a-date')
    logFail('应该抛出错误但未抛出')
  } catch (error) {
    logPass(`正确拒绝无效日期: ${error instanceof Error ? error.message : ''}`)
  }

  // 测试 4.2: 缺少必填字段 name
  console.log('\n测试 4.2: 缺少必填字段 name')
  try {
    await prisma.project.create({
      data: {
        name: '',
        createdById: admin.id,
        totalAmount: 1000,
        targetDate: new Date('2026-08-03').toISOString(),
      } as any,
    })
    logFail('空 name 应该失败但成功了')
  } catch (error) {
    logPass(`正确拒绝空 name: ${error instanceof Error ? error.message.split('\n')[0] : ''}`)
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
    console.log('\n🎉 所有测试通过！项目创建功能正常。')
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
