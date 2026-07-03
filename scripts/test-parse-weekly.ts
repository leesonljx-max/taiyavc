/**
 * 周报解析测试脚本
 * 测试 parseWeeklyReport 函数对标签格式和自然语言格式的解析能力
 * 运行: npx tsx scripts/test-parse-weekly.ts
 */

interface ParsedData {
  name?: string
  companyFullName?: string
  industry?: string
  companyPosition?: string
  mainProducts?: string
  financialData?: string
  orderProgress?: string
  financingPlan?: string
  totalAmount?: string
  description?: string
}

let passCount = 0
let failCount = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`)
    passCount++
  } else {
    console.log(`  ❌ ${msg}`)
    failCount++
  }
}

function assertEqual(actual: any, expected: any, field: string) {
  if (actual === expected) {
    console.log(`  ✅ ${field}: "${actual}"`)
    passCount++
  } else {
    console.log(`  ❌ ${field}: 期望 "${expected}"，实际 "${actual}"`)
    failCount++
  }
}

function assertTruthy(value: any, field: string) {
  if (value) {
    console.log(`  ✅ ${field}: "${value}"`)
    passCount++
  } else {
    console.log(`  ❌ ${field}: 期望有值，实际为空`)
    failCount++
  }
}

/**
 * 增强版周报解析函数（与 page.tsx 中的逻辑保持一致）
 */
function parseWeeklyReport(text: string): ParsedData {
  const parsedData: ParsedData = {}
  const trimmed = text.trim()

  // ========== 1. 标签格式解析（优先匹配）==========

  const nameMatch = trimmed.match(/项目名称[：:]\s*(.+)/)
  if (nameMatch) parsedData.name = nameMatch[1].trim()

  const companyMatch = trimmed.match(/公司全称[：:]\s*(.+)/)
  if (companyMatch) parsedData.companyFullName = companyMatch[1].trim()

  const industryMatch = trimmed.match(/行业[：:]\s*(.+)/)
  if (industryMatch) parsedData.industry = industryMatch[1].trim()

  const positionMatch = trimmed.match(/定位[：:]\s*(.+)/)
  if (positionMatch) parsedData.companyPosition = positionMatch[1].trim()

  const productMatch = trimmed.match(/(?:主要)?产品[：:]\s*(.+)/)
  if (productMatch) parsedData.mainProducts = productMatch[1].trim()

  const financeMatch = trimmed.match(/财务[：:]\s*([\s\S]*?)(?=\n|$)/)
  if (financeMatch) parsedData.financialData = financeMatch[1].trim()

  const orderMatch = trimmed.match(/订单[：:]\s*(.+)/)
  if (orderMatch) parsedData.orderProgress = orderMatch[1].trim()

  const planMatch = trimmed.match(/融资(?:计划)?[：:]\s*(.+)/)
  if (planMatch) parsedData.financingPlan = planMatch[1].trim()

  // ========== 2. 自然语言格式解析（当标签格式未匹配时）==========

  // 项目名称（自然语言）
  if (!parsedData.name) {
    // 模式1: "公司名=定位描述" （用等号分隔，常见于周报简写）
    const equalMatch = trimmed.match(/^([^=，,。：:\n]+)=([^，,。]+)/)
    if (equalMatch) {
      parsedData.name = equalMatch[1].trim()
      if (!parsedData.companyPosition) {
        parsedData.companyPosition = equalMatch[2].trim()
      }
    }

    // 模式2: "XXX是一家..." / "XXX主营..." / "XXX专注..." - 提取主语作为公司名
    if (!parsedData.name) {
      const subjMatch = trimmed.match(/^([^\s，,。：:=\n]+?)(?:是|主营|专注|致力|打造|推出)/)
      if (subjMatch) {
        parsedData.name = subjMatch[1].trim()
      }
    }

    // 模式3: 以"XXX公司"/"XXX科技"/"XXX智能"等后缀结尾的名称（句首到后缀）
    if (!parsedData.name) {
      const suffixMatch = trimmed.match(/^([^\s，,。：:=\n]+?(?:公司|科技|集团|实验室|研究院|智能|技术|网络|生物|医疗|能源|半导体|机器人))(?:[，,。是]|$)/)
      if (suffixMatch) {
        parsedData.name = suffixMatch[1].trim()
      }
    }
  }

  // 公司定位（自然语言）
  if (!parsedData.companyPosition) {
    // "专注于XXX" / "专注XXX"
    const focusMatch = trimmed.match(/专注(?:于)?([^，,。]+)/)
    if (focusMatch) {
      parsedData.companyPosition = focusMatch[1].trim()
    }

    // "是一家XXX" / "是XXX"（但不匹配"是...的"这种短句）
    if (!parsedData.companyPosition) {
      const isMatch = trimmed.match(/(?:^|[，,。])\s*(?:是|主打|提供)\s*(?:一家|一个)?([^，,。]{4,})/)
      if (isMatch) {
        parsedData.companyPosition = isMatch[1].trim()
      }
    }
  }

  // 主要产品（自然语言）
  if (!parsedData.mainProducts) {
    // "打造的XXX机/系统/平台/模型/火箭" 等
    const productMatch2 = trimmed.match(/打造(?:的)?([^，,。]+?(?:机|系统|平台|模型|软件|硬件|产品|工具|应用|引擎|终端|设备|芯片|火箭|汽车|机器人|解决方案|服务))/)
    if (productMatch2) {
      parsedData.mainProducts = productMatch2[1].trim()
    }

    // "推出XXX"
    if (!parsedData.mainProducts) {
      const launchMatch = trimmed.match(/推出(?:了)?([^，,。]+?(?:机|系统|平台|模型|软件|硬件|产品|工具|应用|引擎|终端|设备|芯片|火箭|汽车|机器人|解决方案|服务))/)
      if (launchMatch) {
        parsedData.mainProducts = launchMatch[1].trim()
      }
    }
  }

  // 融资计划（自然语言）
  if (!parsedData.financingPlan) {
    // "本轮融资XXX万" / "融资XXX万" / "拟融资XXX亿" / "计划融资XXX"
    const financeMatch2 = trimmed.match(/((?:本轮融资|本轮|融资|拟融资|计划融资|希望融资|寻求融资)[^，,。\n]*?(?:万|亿)[^，,。\n]*)/)
    if (financeMatch2) {
      parsedData.financingPlan = financeMatch2[1].trim()
    }
  }

  // 目标金额（优先从融资计划中提取，避免"订单XXX万"被误匹配）
  if (!parsedData.totalAmount) {
    // 优先从 financingPlan 中提取金额
    const planSource = parsedData.financingPlan || ''
    if (planSource) {
      const wanMatch = planSource.match(/(\d+(?:\.\d+)?)\s*万/)
      if (wanMatch) {
        parsedData.totalAmount = wanMatch[1]
      }
      if (!parsedData.totalAmount) {
        const yiMatch = planSource.match(/(\d+(?:\.\d+)?)\s*亿/)
        if (yiMatch) {
          parsedData.totalAmount = (parseFloat(yiMatch[1]) * 10000).toString()
        }
      }
    }

    // 如果融资计划里没有，再从全文匹配（但排除"订单"、"销售"等上下文）
    if (!parsedData.totalAmount) {
      // 匹配 "融资XXX万" 或 "XXX万"（但前面不能是"订单"、"销售"、"收入"、"营收"）
      const wanMatch = trimmed.match(/(?:融资|融|金额|投资|拟融|计划融|希望融|寻求融)?(\d+(?:\.\d+)?)\s*万/)
      if (wanMatch) {
        // 检查匹配位置前面是否是"订单"等词
        const matchIndex = trimmed.indexOf(wanMatch[0])
        const prefix = trimmed.substring(Math.max(0, matchIndex - 4), matchIndex)
        if (!/订单|销售|收入|营收/.test(prefix)) {
          parsedData.totalAmount = wanMatch[1]
        }
      }

      if (!parsedData.totalAmount) {
        const yiMatch = trimmed.match(/(?:融资|融|金额|投资|估值|拟融|计划融|希望融|寻求融)?(\d+(?:\.\d+)?)\s*亿/)
        if (yiMatch) {
          parsedData.totalAmount = (parseFloat(yiMatch[1]) * 10000).toString()
        }
      }
    }
  }

  // 财务数据（估值信息）
  if (!parsedData.financialData) {
    // "估值XXX亿" / "估值XXX万"
    const valueMatch = trimmed.match(/估值(\d+(?:\.\d+)?)\s*([亿万])/)
    if (valueMatch) {
      parsedData.financialData = `估值${valueMatch[1]}${valueMatch[2]}`
    }

    // 创始人信息
    const founderMatch = trimmed.match(/创始人[^，,。]*/)
    if (founderMatch) {
      parsedData.financialData = (parsedData.financialData ? parsedData.financialData + '；' : '') + founderMatch[0].trim()
    }
  }

  // 行业（从关键词推断）
  if (!parsedData.industry) {
    const industryKeywords: Array<[string, string]> = [
      ['Agent', 'AI/Agent'],
      ['大模型', 'AI/大模型'],
      ['人工智能', 'AI/人工智能'],
      ['AI', 'AI/人工智能'],
      ['半导体', '半导体'],
      ['芯片', '半导体/芯片'],
      ['医疗', '医疗健康'],
      ['新能源', '新能源'],
      ['SaaS', '企业服务/SaaS'],
      ['金融科技', '金融科技'],
      ['教育', '教育'],
      ['机器人', '机器人'],
      ['记忆体', 'AI/Agent'],
    ]
    for (const [keyword, industry] of industryKeywords) {
      if (trimmed.includes(keyword)) {
        parsedData.industry = industry
        break
      }
    }
  }

  // 描述（整段文本作为描述）
  if (!parsedData.description) {
    if (trimmed.length > 50) {
      parsedData.description = trimmed
    }
  }

  return parsedData
}

// ========== 测试用例 ==========

async function main() {
  console.log('='.repeat(60))
  console.log('🧪 周报解析测试 - 开始')
  console.log('='.repeat(60))

  // ---------- 测试1: 用户报告的自然语言格式 ----------
  console.log('\n' + '━'.repeat(60))
  console.log('测试1: 用户报告的自然语言格式（北京太忆科技）')
  console.log('━'.repeat(60))
  const text1 = '北京太忆科技=Agent 基础记忆体小脑模型，目前Agent面临长程任务的时候仍无法保持连续高可靠的完成任务，而记忆控制系统是让Agent持续可靠完成任务的关键，公司打造的记忆一体机利用时间分成序列和隐空间参数打造高可靠记忆体，创始人目前是自动化所博五的学生，在ACL顶刊上发表了关于记忆体相关的论文，本轮融资2000万，估值1.5亿'
  const result1 = parseWeeklyReport(text1)
  console.log('解析结果:', JSON.stringify(result1, null, 2))
  assertTruthy(result1.name, '项目名称')
  assertEqual(result1.name, '北京太忆科技', '项目名称应为"北京太忆科技"')
  assertTruthy(result1.companyPosition, '公司定位')
  assert(result1.companyPosition?.includes('Agent') || result1.companyPosition?.includes('记忆体'), '公司定位应包含Agent或记忆体')
  assertTruthy(result1.financingPlan, '融资计划')
  assert(result1.financingPlan?.includes('2000万') === true, '融资计划应包含2000万')
  assertEqual(result1.totalAmount, '2000', '目标金额应为2000')
  assertTruthy(result1.financialData, '财务数据')
  assert(result1.financialData?.includes('估值1.5亿') === true, '财务数据应包含估值1.5亿')
  assertTruthy(result1.industry, '行业')
  assert(result1.industry?.includes('AI') === true, '行业应推断为AI相关')

  // ---------- 测试2: 标签格式（确保不破坏原有功能）----------
  console.log('\n' + '━'.repeat(60))
  console.log('测试2: 标签格式（确保不破坏原有功能）')
  console.log('━'.repeat(60))
  const text2 = `项目名称：词元无限
公司全称：词元无限科技有限公司
行业：AI/企业服务
定位：企业级软件研发智能体服务商
产品：安全数字劳动力平台
财务：团队来自字节、阿里
订单：已与多家企业合作
融资计划：寻求Pre-A轮融资`
  const result2 = parseWeeklyReport(text2)
  console.log('解析结果:', JSON.stringify(result2, null, 2))
  assertEqual(result2.name, '词元无限', '项目名称')
  assertEqual(result2.companyFullName, '词元无限科技有限公司', '公司全称')
  assertEqual(result2.industry, 'AI/企业服务', '行业')
  assertEqual(result2.companyPosition, '企业级软件研发智能体服务商', '定位')
  assertEqual(result2.mainProducts, '安全数字劳动力平台', '主要产品')
  assertTruthy(result2.financialData, '财务数据')
  assertTruthy(result2.orderProgress, '订单进度')
  assertEqual(result2.financingPlan, '寻求Pre-A轮融资', '融资计划')

  // ---------- 测试3: 等号分隔的简写格式 ----------
  console.log('\n' + '━'.repeat(60))
  console.log('测试3: 等号分隔的简写格式')
  console.log('━'.repeat(60))
  const text3 = '智谱AI=通用大模型研发，本轮融资10亿，估值100亿'
  const result3 = parseWeeklyReport(text3)
  console.log('解析结果:', JSON.stringify(result3, null, 2))
  assertEqual(result3.name, '智谱AI', '项目名称')
  assertTruthy(result3.companyPosition, '公司定位')
  assert(result3.totalAmount === '100000', '目标金额应为100000（10亿转万元）')

  // ---------- 测试4: 纯描述性自然语言 ----------
  console.log('\n' + '━'.repeat(60))
  console.log('测试4: 纯描述性自然语言（无等号）')
  console.log('━'.repeat(60))
  const text4 = '星河动力是一家商业航天公司，专注于小型商业运载火箭的研发，公司打造的智神星一号火箭已成功发射，本轮拟融资5亿，估值30亿'
  const result4 = parseWeeklyReport(text4)
  console.log('解析结果:', JSON.stringify(result4, null, 2))
  assertEqual(result4.name, '星河动力', '项目名称应匹配公司后缀')
  assertTruthy(result4.companyPosition, '公司定位')
  assert(result4.companyPosition?.includes('商业航天') || result4.companyPosition?.includes('运载火箭'), '定位应包含航天相关')
  assertTruthy(result4.mainProducts, '主要产品')
  assert(result4.mainProducts?.includes('智神星一号') === true, '产品应包含智神星一号')
  assert(result4.totalAmount === '50000', '目标金额应为50000（5亿转万元）')

  // ---------- 测试5: 仅有融资金额的简短文本 ----------
  console.log('\n' + '━'.repeat(60))
  console.log('测试5: 仅有融资金额的简短文本')
  console.log('━'.repeat(60))
  const text5 = '某AI公司，融资3000万'
  const result5 = parseWeeklyReport(text5)
  console.log('解析结果:', JSON.stringify(result5, null, 2))
  assertEqual(result5.totalAmount, '3000', '目标金额应为3000')
  assertTruthy(result5.name, '项目名称应匹配公司后缀')

  // ---------- 测试6: 信人智能案例（用户之前创建失败的项目）----------
  console.log('\n' + '━'.repeat(60))
  console.log('测试6: 信人智能案例')
  console.log('━'.repeat(60))
  const text6 = '南京信人智能科技有限公司=AI决策外脑，主要产品P2/R1，订单1.3万，本轮融资1000万'
  const result6 = parseWeeklyReport(text6)
  console.log('解析结果:', JSON.stringify(result6, null, 2))
  assertEqual(result6.name, '南京信人智能科技有限公司', '项目名称')
  assert(result6.companyPosition?.includes('AI决策外脑') === true, '定位应包含AI决策外脑')
  assertEqual(result6.totalAmount, '1000', '目标金额应为1000')

  // ---------- 测试结果汇总 ----------
  console.log('\n' + '='.repeat(60))
  console.log('📊 测试结果汇总')
  console.log('='.repeat(60))
  console.log(`✅ 通过: ${passCount}`)
  console.log(`❌ 失败: ${failCount}`)
  console.log(`总计: ${passCount + failCount}`)
  console.log('='.repeat(60))

  if (failCount === 0) {
    console.log('\n🎉 所有测试通过！周报解析功能正常。')
  } else {
    console.log('\n⚠️ 存在失败的测试，请检查上方日志。')
  }

  process.exit(failCount === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('❌ 测试脚本执行失败:', e)
  process.exit(1)
})
