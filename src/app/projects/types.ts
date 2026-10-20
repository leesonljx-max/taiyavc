export type FollowStage = 'INITIAL_TALK' | 'PRE_DD' | 'PROJECT_INITIATION' | 'DUE_DILIGENCE' | 'AGREEMENT' | 'CLOSING' | 'POST_INVESTMENT' | 'REJECTED'

export const followStageLabels: Record<FollowStage, string> = {
  INITIAL_TALK: '初聊',
  PRE_DD: 'PreDD',
  PROJECT_INITIATION: '立项',
  DUE_DILIGENCE: '尽调',
  AGREEMENT: '协议',
  CLOSING: '交割',
  POST_INVESTMENT: '投后',
  REJECTED: '已否',
}

// 阶段标签配色：统一为「中性灰 → 深翡翠绿」递进 + 少量功能色（尽调/已否）
export const followStageColors: Record<FollowStage, string> = {
  INITIAL_TALK: 'bg-gray-100 text-gray-600',
  PRE_DD: 'bg-gray-200 text-gray-700',
  PROJECT_INITIATION: 'bg-primary-50 text-primary-700',
  DUE_DILIGENCE: 'bg-warning-50 text-warning-700',
  AGREEMENT: 'bg-primary-100 text-primary-700',
  CLOSING: 'bg-primary-600 text-white',
  POST_INVESTMENT: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-danger-50 text-danger-600',
}
