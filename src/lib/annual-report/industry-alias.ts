/**
 * 行业赛道归一化
 *
 * 项目 industry 是自由文本，直接分组会出现「AI / 人工智能 / AI应用」三个桶。
 * 第一期用配置化别名表归一化，不改数据库；无法识别的统一归入「未分类」。
 */

export const INDUSTRY_ALIAS: Record<string, string> = {
  AI: 'AI应用',
  AIGC: 'AI应用',
  人工智能: 'AI应用',
  生成式AI: 'AI应用',
  大模型: 'AI应用',
  AI大模型: 'AI应用',
  机器人: '具身智能',
  人形机器人: '具身智能',
  具身智能机器人: '具身智能',
  芯片: '半导体芯片',
  半导体: '半导体芯片',
  集成电路: '半导体芯片',
  光伏: '新能源',
  储能: '新能源',
  锂电: '新能源',
  动力电池: '新能源',
  新能源: '新能源',
  创新药: '医疗健康',
  生物医药: '医疗健康',
  医疗器械: '医疗健康',
  医疗健康: '医疗健康',
  SaaS: '企业服务',
  企业服务: '企业服务',
  新消费: '消费',
  消费: '消费',
  航天: '商业航天',
  商业航天: '商业航天',
  eVTOL: '低空经济',
  低空经济: '低空经济',
}

export const UNCLASSIFIED_INDUSTRY = '未分类'

/** 归一化行业名称：去空白、别名合并、空值/纯符号兜底 */
export function normalizeIndustry(raw?: string | null): string {
  const value = (raw ?? '').trim().replace(/\s+/g, '')
  if (!value) return UNCLASSIFIED_INDUSTRY
  // 纯符号视为未分类
  if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(value)) return UNCLASSIFIED_INDUSTRY
  return INDUSTRY_ALIAS[value] ?? value
}
