/**
 * M1 测试：尽调工作台框架模板与常量完整性
 *
 * 依据：《项目尽调模块优化技术规划与执行方案》§3 九大模块、§4 证据等级
 * 保证：模板结构完整（批次创建的底座）、状态机/等级白名单自洽
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DD_TEMPLATE_MODULES,
  DD_TEMPLATE_VERSION,
  getTemplateModule,
  DD_MODULE_NAME_LABELS,
} from '@/lib/dd-workbench/template'
import {
  DD_BATCH_STATUSES,
  DD_TASK_STATUSES,
  DD_TASK_TRANSITIONS,
  DD_RED_FLAG_LEVELS,
  DD_EVIDENCE_SOURCE_TYPES,
  DD_EVIDENCE_GRADES,
  DD_EVIDENCE_STATUSES,
  REPORT_SUPPORTED_GRADES,
  DD_REPORT_TYPES,
  isDDBatchStatus,
  isDDTaskStatus,
  isDDRedFlagLevel,
  isDDEvidenceSourceType,
  isDDEvidenceGrade,
  isDDEvidenceStatus,
} from '@/lib/dd-workbench/constants'
import './helpers/setup'

// ── 模板完整性 ──

test('模板 v1：九大模块，key 唯一且与文档 §3 顺序一致', () => {
  assert.equal(DD_TEMPLATE_MODULES.length, 9)
  const keys = DD_TEMPLATE_MODULES.map(m => m.key)
  assert.equal(new Set(keys).size, 9, 'moduleKey 不得重复')
  // 文档 §3 顺序：项目与主体 → 产品与技术 → 团队与治理 → 市场与客户 → 商业化与订单
  //              → 竞争与壁垒 → 财务与单位经济 → 法务合规与风险 → 估值与交易
  assert.deepEqual(
    DD_TEMPLATE_MODULES.map(m => m.name),
    [
      '项目与主体',
      '产品与技术',
      '团队与治理',
      '市场与客户',
      '商业化与订单',
      '竞争与壁垒',
      '财务与单位经济',
      '法务合规与风险',
      '估值与交易',
    ]
  )
})

test('每个模板模块字段完整：核心问题/输入输出/建议责任/排序', () => {
  for (const m of DD_TEMPLATE_MODULES) {
    assert.ok(m.key.length >= 2, `${m.key} 标识过短`)
    assert.ok(m.coreQuestion.endsWith('？'), `${m.name} 核心问题应以问号结尾`)
    assert.ok(m.inputs.length > 0, `${m.name} 缺少主要输入与输出`)
    assert.ok(m.ownerRole.length > 0, `${m.name} 缺少建议责任`)
  }
  // sortKey 连续 1..9
  assert.deepEqual(
    DD_TEMPLATE_MODULES.map(m => m.sortKey),
    [1, 2, 3, 4, 5, 6, 7, 8, 9]
  )
})

test('getTemplateModule / DD_MODULE_NAME_LABELS 查询一致', () => {
  for (const m of DD_TEMPLATE_MODULES) {
    assert.equal(getTemplateModule(m.key)?.name, m.name)
    assert.equal(DD_MODULE_NAME_LABELS[m.key], m.name)
  }
  assert.equal(getTemplateModule('NOT_EXIST'), undefined)
  assert.equal(DD_TEMPLATE_VERSION, 'v1')
})

// ── 状态机与等级白名单 ──

test('批次/任务/红旗/证据枚举白名单', () => {
  assert.deepEqual(DD_BATCH_STATUSES, ['IN_PROGRESS', 'IN_REVIEW', 'FROZEN'])
  assert.deepEqual(DD_TASK_STATUSES, ['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED'])
  assert.deepEqual(DD_RED_FLAG_LEVELS, ['NONE', 'MEDIUM', 'HIGH'])
  assert.deepEqual(DD_EVIDENCE_SOURCE_TYPES, ['DOCUMENT', 'WEB', 'MANUAL'])
  assert.deepEqual(DD_EVIDENCE_GRADES, ['A', 'B', 'C', 'D'])
  assert.deepEqual(DD_EVIDENCE_STATUSES, ['PENDING', 'CONFIRMED', 'CONFLICT'])
  assert.deepEqual(DD_REPORT_TYPES, ['FULL_PACKAGE', 'MODULE'])
})

test('任务状态机：流转表覆盖所有状态且自洽', () => {
  for (const s of DD_TASK_STATUSES) {
    assert.ok(DD_TASK_TRANSITIONS[s], `缺少状态 ${s} 的流转定义`)
  }
  // DONE 仅可重开回 IN_PROGRESS（复核后重做）
  assert.deepEqual(DD_TASK_TRANSITIONS.DONE, ['IN_PROGRESS'])
  // BLOCKED 可回 PENDING / IN_PROGRESS
  assert.ok(DD_TASK_TRANSITIONS.BLOCKED.includes('IN_PROGRESS'))
  // 流转目标必须是合法状态
  for (const [from, tos] of Object.entries(DD_TASK_TRANSITIONS)) {
    for (const to of tos) {
      assert.ok(isDDTaskStatus(to), `非法流转目标 ${from} → ${to}`)
      assert.notEqual(to, from, `状态 ${from} 不应自流转`)
    }
  }
})

test('证据等级规则：D 不可支撑关键结论，A/B/C 可支撑', () => {
  assert.deepEqual(REPORT_SUPPORTED_GRADES, ['A', 'B', 'C'])
  assert.ok(!REPORT_SUPPORTED_GRADES.includes('D'))
})

test('类型守卫：合法值通过、非法值拒绝', () => {
  assert.ok(isDDBatchStatus('FROZEN'))
  assert.ok(!isDDBatchStatus('DELETED'))
  assert.ok(isDDTaskStatus('BLOCKED'))
  assert.ok(!isDDTaskStatus('CANCELLED'))
  assert.ok(isDDRedFlagLevel('HIGH'))
  assert.ok(!isDDRedFlagLevel('CRITICAL'))
  assert.ok(isDDEvidenceSourceType('MANUAL'))
  assert.ok(!isDDEvidenceSourceType('EMAIL'))
  assert.ok(isDDEvidenceGrade('D'))
  assert.ok(!isDDEvidenceGrade('E'))
  assert.ok(isDDEvidenceStatus('CONFLICT'))
  assert.ok(!isDDEvidenceStatus('REJECTED'))
})
