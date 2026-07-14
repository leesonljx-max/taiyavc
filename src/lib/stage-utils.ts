import type { FollowStage } from '@/app/projects/types'

/**
 * 阶段顺序（从早到晚）
 */
export const STAGE_ORDER: FollowStage[] = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'AGREEMENT',
  'CLOSING',
  'POST_INVESTMENT',
]

/**
 * 解析 passedStages 字段（JSON 字符串 → FollowStage 数组）
 * 向后兼容：如果项目在 AGREEMENT 阶段添加前已进入 CLOSING/POST_INVESTMENT，
 * 自动补齐 AGREEMENT（以最新阶段为准回填所有前置阶段）
 */
export function parsePassedStages(raw: string | null | undefined): FollowStage[] {
  if (!raw) return ['INITIAL_TALK']
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr) && arr.length > 0) {
      const stages = arr as FollowStage[]
      // 找到数组中最靠后的阶段索引
      let latestIdx = -1
      for (const s of stages) {
        const idx = STAGE_ORDER.indexOf(s)
        if (idx > latestIdx) latestIdx = idx
      }
      if (latestIdx >= 0) {
        // 补齐从 INITIAL_TALK 到 latestIdx 的所有阶段（合并去重）
        const required = STAGE_ORDER.slice(0, latestIdx + 1)
        const set = new Set<FollowStage>([...stages, ...required])
        return STAGE_ORDER.filter(s => set.has(s))
      }
      return stages
    }
  } catch {
    // 解析失败，回退
  }
  return ['INITIAL_TALK']
}

/**
 * 根据当前阶段，计算经过的所有阶段（补齐中间阶段）
 * 例如：从 PRE_DD 跳到 DUE_DILIGENCE，会补齐 PROJECT_INITIATION
 *
 * @param currentPassedStages 当前已记录的经过阶段
 * @param newStage 新阶段
 * @returns 更新后的 passedStages（包含从 INITIAL_TALK 到 newStage 的所有阶段）
 */
export function computePassedStages(
  currentPassedStages: FollowStage[],
  newStage: FollowStage
): FollowStage[] {
  const newIdx = STAGE_ORDER.indexOf(newStage)
  if (newIdx === -1) return currentPassedStages

  // 新阶段及其所有前置阶段
  const requiredStages = STAGE_ORDER.slice(0, newIdx + 1)

  // 合并去重
  const set = new Set<FollowStage>([...currentPassedStages, ...requiredStages])

  // 按阶段顺序排序
  return STAGE_ORDER.filter(s => set.has(s))
}

/**
 * 判断项目是否经过了某个阶段（用于累计统计）
 */
export function hasPassedStage(
  passedStagesRaw: string | null | undefined,
  stage: FollowStage
): boolean {
  const passed = parsePassedStages(passedStagesRaw)
  return passed.includes(stage)
}
