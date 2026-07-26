/**
 * 构造投研分析模拟数据
 *
 * 为现有的尽调阶段项目创建 9 个模块的模拟数据
 * 包括：AI 分析结果、手动输入内容、模拟文档记录
 *
 * 运行: npx tsx scripts/seed-research-data.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// 9 个模块的模拟数据
const MODULE_MOCK_DATA: Record<string, {
  content: Record<string, string>
  aiJson: Record<string, unknown>
  aiSummary: string
}> = {
  INDUSTRY: {
    content: { supplement: '重点关注 AI 应用层的发展趋势' },
    aiJson: {
      developmentStage: '成长期',
      marketSize: '约 500 亿元',
      growthRate: '25%',
      trlLevel: 7,
      trlDescription: 'TRL 7 - 系统原型验证通过，接近商业化',
      keyTrends: ['多模态融合加速', '行业垂直化落地', '边缘 AI 部署增长'],
      challenges: ['算力成本高', '数据合规要求提升', '同质化竞争加剧'],
      summary: 'AI 应用行业处于成长期，市场规模约 500 亿元，年增速 25%，TRL 7 级接近商业化。',
    },
    aiSummary: 'AI 应用行业处于成长期，市场规模约 500 亿元，年增速 25%，TRL 7 级接近商业化。',
  },

  PRODUCT_TECH: {
    content: { supplement: '核心产品为 AI 视觉分析平台' },
    aiJson: {
      productPositioning: '企业级 AI 视觉分析平台',
      targetMarket: '安防、零售、工业质检',
      techRoute: '基于深度学习的计算机视觉 + 边缘计算',
      techAdvantages: ['自研轻量化模型', '边缘端推理优化', '多场景快速适配'],
      differentiation: '聚焦边缘端部署，成本仅为云端方案的 30%',
      techBarriers: ['模型压缩专利', '边缘硬件适配经验', '行业数据积累'],
      maturity: '量产',
      summary: 'AI 视觉分析平台已进入量产阶段，边缘端部署是核心差异化优势。',
    },
    aiSummary: 'AI 视觉分析平台已进入量产阶段，边缘端部署是核心差异化优势。',
  },

  COMPETITION: {
    content: { supplement: '主要关注商汤、旷视等头部厂商' },
    aiJson: {
      competitors: [
        { projectName: '商汤科技', productPositioning: '通用 AI 平台', marketStrategy: '平台化+生态合作', businessProgress: '已上市，营收 38 亿', teamBackground: '汤晓鸥，MIT 博士', latestRound: '已上市', amount: 'IPO 募资 60 亿港币' },
        { projectName: '旷视科技', productPositioning: 'AI+IoT', marketStrategy: '行业纵深+硬件', businessProgress: '提交 IPO 申请', teamBackground: '印奇，清华姚班', latestRound: 'D 轮', amount: '9 亿美元' },
        { projectName: '云从科技', productPositioning: '人机协同平台', marketStrategy: '金融+安防', businessProgress: '已上市，营收 5 亿', teamBackground: '周曦，中科院博士', latestRound: '已上市', amount: 'IPO 募资 18 亿' },
      ],
      competitiveLandscape: '行业头部厂商已完成上市，竞争焦点从技术转向场景落地和成本控制。',
    },
    aiSummary: '行业头部厂商已完成上市，竞争焦点从技术转向场景落地和成本控制。',
  },

  BUSINESS_DD: {
    content: { supplement: '前 3 大客户占比约 60%' },
    aiJson: {
      topCustomers: [
        { name: '某安防集团', revenue: '35%', cooperationDate: '2024-01', status: '稳定合作' },
        { name: '某零售连锁', revenue: '15%', cooperationDate: '2024-03', status: '扩量中' },
        { name: '某制造企业', revenue: '10%', cooperationDate: '2024-06', status: '试点中' },
      ],
      signedOrders: [
        { customer: '某安防集团', amount: '1200 万', date: '2025-12', product: 'AI 视觉平台' },
        { customer: '某零售连锁', amount: '500 万', date: '2026-01', product: '智能货架' },
      ],
      intentOrders: [
        { customer: '某制造企业', estimatedAmount: '800 万', probability: '70%', stage: 'POC 中' },
      ],
      customerReviews: [
        { customer: '某安防集团', rating: '4.5/5', feedback: '产品稳定，响应快' },
      ],
      summary: '前 3 大客户占比 60%，已签订单 1700 万，意向订单 800 万，客户评价良好。',
    },
    aiSummary: '前 3 大客户占比 60%，已签订单 1700 万，意向订单 800 万，客户评价良好。',
  },

  FINANCIAL_DD: {
    content: { supplement: '2025 年营收增长 80%' },
    aiJson: {
      revenue: { latestYear: '3500 万', previousYear: '1900 万', growth: '84%' },
      profit: { latestYear: '-200 万', previousYear: '-800 万' },
      cashFlow: { operating: '-300 万', investing: '-500 万', financing: '2000 万' },
      balanceSheet: { totalAssets: '5000 万', totalLiabilities: '1500 万', netAssets: '3500 万' },
      keyMetrics: { grossMargin: '65%', netMargin: '-6%', burnRate: '50 万/月' },
      risks: ['尚未盈利', '应收账款周期较长'],
      summary: '营收高速增长 84%，毛利率 65%，但尚未盈利，月烧钱 50 万。',
    },
    aiSummary: '营收高速增长 84%，毛利率 65%，但尚未盈利，月烧钱 50 万。',
  },

  TEAM: {
    content: { supplement: '创始人为前 BAT 高管' },
    aiJson: {
      founder: {
        name: '张某某',
        background: '清华大学计算机硕士',
        experience: '前阿里 P9，10 年 AI 领域经验',
        achievements: '主导多个亿级 AI 项目落地',
      },
      coreMembers: [
        { name: '李某某', title: 'CTO', background: 'MIT 博士', experience: '前谷歌研究员' },
        { name: '王某某', title: 'VP销售', background: '北大 MBA', experience: '前华为企业业务总监' },
      ],
      teamStrength: '技术+商业双重背景，核心团队完整',
      teamGaps: ['CFO 缺失', '海外市场负责人待补充'],
      summary: '核心团队技术+商业背景互补，但 CFO 和海外市场负责人待补充。',
    },
    aiSummary: '核心团队技术+商业背景互补，但 CFO 和海外市场负责人待补充。',
  },

  COMPANY: {
    content: { supplement: '公司成立于 2020 年' },
    aiJson: {
      basicInfo: {
        foundedDate: '2020-06',
        registeredCapital: '1000 万人民币',
        location: '北京海淀区',
        legalRepresentative: '张某某',
      },
      shareholderStructure: [
        { name: '张某某', percentage: '45%', type: '创始人' },
        { name: '某投资机构 A', percentage: '20%', type: '机构' },
        { name: '员工持股平台', percentage: '15%', type: 'ESOP' },
      ],
      developmentHistory: [
        { date: '2020-06', event: '公司成立' },
        { date: '2021-03', event: '完成天使轮融资' },
        { date: '2022-09', event: '完成 A 轮融资' },
        { date: '2024-01', event: '产品量产' },
      ],
      businessScope: '人工智能技术研发、计算机视觉、软件开发',
      summary: '公司成立于 2020 年，已完成 A 轮融资，注册资本 1000 万，创始人持股 45%。',
    },
    aiSummary: '公司成立于 2020 年，已完成 A 轮融资，注册资本 1000 万，创始人持股 45%。',
  },

  FINANCING: {
    content: {
      financingAmount: '5000 万元',
      preValuation: '3 亿元',
      oldShareValuation: '2.5 亿元',
      otherInstitutions: '红杉资本正在评估中，预计 2 周内给出 TS',
      coreTerms: '优先清算权 1x, 反稀释条款（加权平均）, 董事会席位 1 席, 退出期 5 年',
    },
    aiJson: {},
    aiSummary: '',
  },

  RECOMMENDATION: {
    content: {
      investmentRange: '1000-1500 万元',
      investmentType: '跟投',
      recommendation: '项目技术壁垒较高，营收增长迅速，建议跟投 1000-1500 万元。需关注盈利时间点和现金流情况。',
    },
    aiJson: {},
    aiSummary: '',
  },
}

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  构造投研分析模拟数据')
  console.log('═══════════════════════════════════════════════════\n')

  // 查询所有尽调阶段项目
  const dueDiligenceProjects = await prisma.project.findMany({
    where: { followStage: 'DUE_DILIGENCE' },
    select: { id: true, name: true, createdById: true },
  })

  console.log(`找到 ${dueDiligenceProjects.length} 个尽调阶段项目：`)
  dueDiligenceProjects.forEach(p => console.log(`  - ${p.name} (${p.id})`))

  if (dueDiligenceProjects.length === 0) {
    console.log('\n⚠️  没有尽调阶段项目，请先将某个项目改为尽调阶段')
    return
  }

  // 为每个尽调项目创建 9 个模块的模拟数据
  for (const project of dueDiligenceProjects) {
    console.log(`\n正在为项目 "${project.name}" 创建模拟数据...`)

    // 删除现有模块数据（重新创建）
    await prisma.researchModule.deleteMany({
      where: { projectId: project.id },
    })

    // 创建 9 个模块
    for (const [moduleType, mockData] of Object.entries(MODULE_MOCK_DATA)) {
      const analyzedAt = mockData.aiSummary ? new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000) : null

      await prisma.researchModule.create({
        data: {
          projectId: project.id,
          moduleType,
          content: JSON.stringify(mockData.content),
          aiJson: mockData.aiSummary ? JSON.stringify(mockData.aiJson) : null,
          aiSummary: mockData.aiSummary || null,
          analyzedAt,
        },
      })
      console.log(`  ✓ ${moduleType} 模块已创建${analyzedAt ? '（含 AI 分析结果）' : ''}`)
    }
  }

  console.log('\n═══════════════════════════════════════════════════')
  console.log('  模拟数据创建完成！')
  console.log('═══════════════════════════════════════════════════')
  console.log('\n现在可以访问 http://localhost:3000/research 查看投研分析页面')
  console.log('点击项目卡片进入详情页，查看 9 个模块的模拟数据')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
