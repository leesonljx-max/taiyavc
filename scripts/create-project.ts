import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  })

  if (!adminUser) {
    console.error('❌ 未找到管理员用户，请先创建管理员账户')
    await prisma.$disconnect()
    return
  }

  const existingProject = await prisma.project.findFirst({
    where: { name: '词元无限' },
  })

  if (existingProject) {
    console.log(`❌ 项目「词元无限」已存在，跳过创建`)
    await prisma.$disconnect()
    return
  }

  const project = await prisma.project.create({
    data: {
      name: '词元无限',
      companyFullName: '词元无限科技有限公司',
      industry: 'AI/企业服务/软件研发',
      companyPosition: '企业级软件研发智能体专属服务商，专注大型研发组织AI转型，提供贯穿研测交全链路的"安全数字劳动力"，助力企业将AI从局部试点升级为安全可信的组织级核心研发产能',
      mainProducts: '安全数字劳动力平台 - 贯穿研测交全链路的企业级AI原生交付体系',
      financialData: JSON.stringify({
        团队背景: '来自字节、阿里、微软等头部企业，兼具万人级工程落地经验与前沿AI研究能力',
        合作院校: '北航复杂软件实验室、清华人工智能学院',
        典型客户: '神州信息、国耀融汇、飞书、航天网信、国恩未来、摩尔线程、广联达、北京腾河',
      }),
      orderProgress: '已与多家大型企业建立合作关系，覆盖金融、政企、能源、高端制造、轨道交通、互联网等行业',
      financingPlan: '寻求Pre-A轮融资，用于产品研发和市场拓展',
      followStage: 'INITIAL_TALK',
      description: '词元无限专注大型研发组织AI转型。核心理念是拒绝工具拼凑，构建以"数字劳动力"为核心的企业级AI原生交付体系，实现生产力确定性跃升。深耕金融、政企、能源、高端制造、轨道交通及互联网等拥有复杂业务场景的大型研发组织。',
      status: 'PENDING',
      totalAmount: '5000',
      raisedAmount: 0,
      targetDate: new Date('2026-12-31'),
      keywords: '词元无限,AI智能体,企业服务,数字劳动力,安全AI',
      createdById: adminUser.id,
    },
  })

  console.log(`✅ 项目创建成功`)
  console.log(`项目名称: ${project.name}`)
  console.log(`公司全称: ${project.companyFullName}`)
  console.log(`行业: ${project.industry}`)
  console.log(`目标金额: ¥${project.totalAmount}万元`)
  console.log(`跟进阶段: 初聊`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('❌ 创建项目失败:', e)
  await prisma.$disconnect()
  process.exit(1)
})