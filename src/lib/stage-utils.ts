import type { FollowStage } from '@/app/projects/types'

/**
 * 阶段顺序（从早到晚）
 */
export const STAGE_ORDER: FollowStage[] = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'CLOSING',
  'POST_INVESTMENT',
]

/**
 * 解析 passedStages 字段（JSON 字符串 → FollowStage 数组）
 */
export function parsePassedStages(raw: string | null | undefined): FollowStage[] {
  if (!raw) return ['INITIAL_TALK']
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr) && arr.length > 0) {
      return arr as FollowStage[]
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
