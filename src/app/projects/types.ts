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

export const followStageColors: Record<FollowStage, string> = {
  INITIAL_TALK: 'bg-gray-100 text-gray-800',
  PRE_DD: 'bg-blue-100 text-blue-800',
  PROJECT_INITIATION: 'bg-purple-100 text-purple-800',
  DUE_DILIGENCE: 'bg-yellow-100 text-yellow-800',
  AGREEMENT: 'bg-teal-100 text-teal-800',
  CLOSING: 'bg-orange-100 text-orange-800',
  POST_INVESTMENT: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
}
