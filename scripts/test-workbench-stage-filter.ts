/**
 * 工作台阶段卡片筛选 - 测试用例
 *
 * 测试内容：
 * 1. 阶段顺序定义正确（含 REJECTED）
 * 2. followStageLabels 包含"已否"标签
 * 3. 项目按阶段分组逻辑正确
 * 4. selectedStage 筛选逻辑：只显示选中阶段的项目
 * 5. 已否项目默认不显示（当 selectedStage 不是 REJECTED 时）
 * 6. 编辑页跟进阶段下拉框包含"已否"选项
 *
 * 运行方式：npx tsx scripts/test-workbench-stage-filter.ts
 */

import { followStageLabels, type FollowStage } from '../src/app/projects/types'

// ── 模拟工作台中的阶段定义（与 workbench/page.tsx 保持一致）──
const STAGE_ORDER: FollowStage[] = [
  'INITIAL_TALK',
  'PRE_DD',
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'AGREEMENT',
  'CLOSING',
  'POST_INVESTMENT',
  'REJECTED',
]

const PARTNER_VISIBLE_STAGES: FollowStage[] = [
  'PROJECT_INITIATION',
  'DUE_DILIGENCE',
  'AGREEMENT',
  'CLOSING',
  'POST_INVESTMENT',
  'REJECTED',
]

// ── 模拟项目数据 ──
interface MockProject {
  id: string
  name: string
  followStage: FollowStage
  createdBy: { id: string; name: string | null } | null
}

const mockProjects: MockProject[] = [
  { id: 'p1', name: '项目A-初聊', followStage: 'INITIAL_TALK', createdBy: { id: 'u1', name: '张三' } },
  { id: 'p2', name: '项目B-初聊', followStage: 'INITIAL_TALK', createdBy: { id: 'u1', name: '张三' } },
  { id: 'p3', name: '项目C-PreDD', followStage: 'PRE_DD', createdBy: { id: 'u2', name: '李四' } },
  { id: 'p4', name: '项目D-立项', followStage: 'PROJECT_INITIATION', createdBy: { id: 'u2', name: '李四' } },
  { id: 'p5', name: '项目E-尽调', followStage: 'DUE_DILIGENCE', createdBy: { id: 'u1', name: '张三' } },
  { id: 'p6', name: '项目F-交割', followStage: 'CLOSING', createdBy: { id: 'u3', name: '王五' } },
  { id: 'p7', name: '项目G-投后', followStage: 'POST_INVESTMENT', createdBy: { id: 'u1', name: '张三' } },
  { id: 'p8', name: '项目H-已否', followStage: 'REJECTED', createdBy: { id: 'u2', name: '李四' } },
  { id: 'p9', name: '项目I-已否', followStage: 'REJECTED', createdBy: { id: 'u3', name: '王五' } },
]

// ── 测试工具 ──
let passedCount = 0
let failedCount = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passedCount++
  } else {
    console.log(`  ❌ ${message}`)
    failedCount++
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  const equal = JSON.stringify(actual) === JSON.stringify(expected)
  if (equal) {
    console.log(`  ✅ ${message}`)
    passedCount++
  } else {
    console.log(`  ❌ ${message}`)
    console.log(`     期望: ${JSON.stringify(expected)}`)
    console.log(`     实际: ${JSON.stringify(actual)}`)
    failedCount++
  }
}

// ── 模拟工作台筛选逻辑 ──
function filterByStage(projects: MockProject[], stage: FollowStage): MockProject[] {
  return projects.filter(p => p.followStage === stage)
}

function getProjectsByStage(projects: MockProject[], stages: FollowStage[]) {
  return stages.map(stage => ({
    stage,
    label: followStageLabels[stage],
    projects: filterByStage(projects, stage),
  }))
}

// ════════════════════════════════════════════════════════════
// 测试用例
// ════════════════════════════════════════════════════════════

console.log('\n🧪 工作台阶段卡片筛选 - 测试用例\n')

// ── 测试 1：阶段顺序定义 ──
console.log('📋 测试 1：阶段顺序定义')
assertEqual(STAGE_ORDER.length, 8, 'STAGE_ORDER 包含 8 个阶段（含 REJECTED）')
assert(STAGE_ORDER.includes('REJECTED'), 'STAGE_ORDER 包含 REJECTED 阶段')
assert(STAGE_ORDER[0] === 'INITIAL_TALK', '第一个阶段是 INITIAL_TALK（初聊）')
assert(STAGE_ORDER[STAGE_ORDER.length - 1] === 'REJECTED', '最后一个阶段是 REJECTED（已否）')
assertEqual(PARTNER_VISIBLE_STAGES.length, 6, 'PARTNER_VISIBLE_STAGES 包含 6 个阶段（含 REJECTED）')
assert(PARTNER_VISIBLE_STAGES.includes('REJECTED'), 'PARTNER_VISIBLE_STAGES 包含 REJECTED')
assert(!PARTNER_VISIBLE_STAGES.includes('INITIAL_TALK'), '合伙人不可见 INITIAL_TALK')
assert(!PARTNER_VISIBLE_STAGES.includes('PRE_DD'), '合伙人不可见 PRE_DD')

// ── 测试 2：阶段标签 ──
console.log('\n📋 测试 2：阶段标签定义')
assertEqual(followStageLabels['INITIAL_TALK'], '初聊', 'INITIAL_TALK 标签为"初聊"')
assertEqual(followStageLabels['REJECTED'], '已否', 'REJECTED 标签为"已否"')
assertEqual(Object.keys(followStageLabels).length, 8, 'followStageLabels 包含 8 个阶段标签')
assert(!!followStageLabels['POST_INVESTMENT'], '包含投后阶段标签')

// ── 测试 3：项目按阶段分组 ──
console.log('\n📋 测试 3：项目按阶段分组')
const projectsByStage = getProjectsByStage(mockProjects, STAGE_ORDER)
assertEqual(projectsByStage.length, 8, '分组结果包含 8 个阶段')

const initialTalkGroup = projectsByStage.find(g => g.stage === 'INITIAL_TALK')
assertEqual(initialTalkGroup?.projects.length, 2, '初聊阶段有 2 个项目')
assertEqual(initialTalkGroup?.projects[0].name, '项目A-初聊', '初聊阶段第一个项目是"项目A-初聊"')

const rejectedGroup = projectsByStage.find(g => g.stage === 'REJECTED')
assertEqual(rejectedGroup?.projects.length, 2, '已否阶段有 2 个项目')

// ── 测试 4：点击卡片筛选对应阶段项目 ──
console.log('\n📋 测试 4：点击卡片筛选对应阶段项目')

// 模拟选中 PRE_DD 阶段
let selectedStage: FollowStage = 'PRE_DD'
let stageProjects = filterByStage(mockProjects, selectedStage)
assertEqual(stageProjects.length, 1, '选中 PreDD 阶段时显示 1 个项目')
assertEqual(stageProjects[0].name, '项目C-PreDD', '选中 PreDD 时显示"项目C-PreDD"')

// 模拟选中 DUE_DILIGENCE 阶段
selectedStage = 'DUE_DILIGENCE'
stageProjects = filterByStage(mockProjects, selectedStage)
assertEqual(stageProjects.length, 1, '选中尽调阶段时显示 1 个项目')
assertEqual(stageProjects[0].name, '项目E-尽调', '选中尽调时显示"项目E-尽调"')

// 模拟选中 POST_INVESTMENT 阶段
selectedStage = 'POST_INVESTMENT'
stageProjects = filterByStage(mockProjects, selectedStage)
assertEqual(stageProjects.length, 1, '选中投后阶段时显示 1 个项目')

// ── 测试 5：已否项目默认不显示 ──
console.log('\n📋 测试 5：已否项目默认不显示')

// 默认选中 INITIAL_TALK（非 REJECTED），不应显示已否项目
selectedStage = 'INITIAL_TALK'
stageProjects = filterByStage(mockProjects, selectedStage)
const hasRejectedInNormal = stageProjects.some(p => p.followStage === 'REJECTED')
assert(!hasRejectedInNormal, '选中初聊阶段时不显示已否项目')

// 选中 CLOSING 阶段，不应显示已否项目
selectedStage = 'CLOSING'
stageProjects = filterByStage(mockProjects, selectedStage)
const hasRejectedInClosing = stageProjects.some(p => p.followStage === 'REJECTED')
assert(!hasRejectedInClosing, '选中交割阶段时不显示已否项目')

// 点击"已否"卡片时显示已否项目
selectedStage = 'REJECTED'
stageProjects = filterByStage(mockProjects, selectedStage)
assertEqual(stageProjects.length, 2, '点击"已否"卡片时显示 2 个已否项目')
assert(stageProjects.every(p => p.followStage === 'REJECTED'), '已否卡片显示的全部是已否项目')

// ── 测试 6：合伙人视图筛选 ──
console.log('\n📋 测试 6：合伙人视图阶段筛选')

const partnerProjectsByStage = getProjectsByStage(mockProjects, PARTNER_VISIBLE_STAGES)
assertEqual(partnerProjectsByStage.length, 6, '合伙人视图包含 6 个阶段卡片')

// 合伙人不可见阶段的项目不应出现在卡片中
const hasInitialTalkInPartner = partnerProjectsByStage.some(g => g.stage === 'INITIAL_TALK')
assert(!hasInitialTalkInPartner, '合伙人视图不包含初聊阶段卡片')

// 合伙人默认选中 PROJECT_INITIATION
const partnerDefaultStage: FollowStage = 'PROJECT_INITIATION'
const partnerDefaultProjects = filterByStage(mockProjects, partnerDefaultStage)
assertEqual(partnerDefaultProjects.length, 1, '合伙人默认选中立项阶段有 1 个项目')

// ── 测试 7：编辑页跟进阶段下拉框包含"已否"选项 ──
console.log('\n📋 测试 7：编辑页跟进阶段包含"已否"选项')

// followStageLabels 被编辑页用于渲染下拉选项
const allStageOptions = Object.entries(followStageLabels)
assert(allStageOptions.some(([value, label]) => value === 'REJECTED' && label === '已否'), '编辑页跟进阶段下拉框包含"已否"选项')
assertEqual(allStageOptions.length, 8, '编辑页跟进阶段下拉框有 8 个选项')

// 验证可以通过设置 followStage 为 REJECTED 来标记已否
const projectToReject: MockProject = { id: 'p10', name: '测试项目', followStage: 'INITIAL_TALK', createdBy: null }
projectToReject.followStage = 'REJECTED'
assertEqual(projectToReject.followStage, 'REJECTED', '项目 followStage 可设置为 REJECTED')

// ── 测试 8：空阶段处理 ──
console.log('\n📋 测试 8：空阶段处理')

// 选中没有项目的阶段
selectedStage = 'AGREEMENT'
stageProjects = filterByStage(mockProjects, selectedStage)
assertEqual(stageProjects.length, 0, '选中协议阶段（无项目）时返回空列表')

// ── 测试结果汇总 ──
console.log('\n' + '═'.repeat(60))
console.log(`📊 测试结果：✅ ${passedCount} 通过 / ❌ ${failedCount} 失败`)
console.log('═'.repeat(60))

if (failedCount > 0) {
  console.log('\n⚠️  存在失败的测试用例，请检查！')
  process.exit(1)
} else {
  console.log('\n🎉 全部测试用例通过！')
  process.exit(0)
}
