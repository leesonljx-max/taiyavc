/**
 * 权限 where 等价性测试（核心回归网）
 *
 * 保证 buildProjectVisibilityWhere / buildProjectScopeWhere 生成的 Prisma where
 * 与逐行调用 canViewProject / isMaintainedByUser 的结果完全一致——
 * 这是服务端分页正确性的前提（take/skip 要求过滤完全在 DB 层）。
 *
 * 同时拦截阶段名单漂移：新增 FollowStage 枚举值时 OPEN_VIEW_STAGES 未同步会在此失败。
 */
import './helpers/setup'

import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'

import {
  canViewProject,
  isMaintainedByUser,
  OPEN_VIEW_STAGES,
  FALLBACK_VIEW_STAGES,
  ALL_VIEW_STAGES,
  PUBLIC_STAGES,
  RESTRICTED_STAGES,
  type PermissionUser,
} from '@/lib/permissions'
import { buildProjectVisibilityWhere, buildProjectScopeWhere } from '@/lib/project-where'
import prisma from '@/lib/prisma'
import type { FollowStage } from '@/app/projects/types'

const SUFFIX = String(Date.now()).slice(-6)
const EMAILS = {
  admin: `equiv-admin-${SUFFIX}@test.local`,
  partner: `equiv-partner-${SUFFIX}@test.local`,
  manager: `equiv-manager-${SUFFIX}@test.local`,
  visitor: `equiv-visitor-${SUFFIX}@test.local`,
  owner: `equiv-owner-${SUFFIX}@test.local`,
}

const ALL_STAGES: FollowStage[] = [
  'INITIAL_TALK', 'PRE_DD', 'PROJECT_INITIATION', 'DUE_DILIGENCE',
  'AGREEMENT', 'CLOSING', 'POST_INVESTMENT', 'REJECTED',
]

interface SeededProject {
  key: string
  id: string
  followStage: FollowStage
  createdById: string
  memberIds: string[]
}

let seeded: SeededProject[] = []

beforeEach(async () => {
  await prisma.project.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } })

  const users = {
    admin: await prisma.user.create({ data: { email: EMAILS.admin, name: '管理员', passwordHash: 'x', role: 'ADMIN' } }),
    partner: await prisma.user.create({ data: { email: EMAILS.partner, name: '合伙人', passwordHash: 'x', role: 'INVESTMENT_PARTNER' } }),
    manager: await prisma.user.create({ data: { email: EMAILS.manager, name: '经理', passwordHash: 'x', role: 'INVESTMENT_MANAGER' } }),
    visitor: await prisma.user.create({ data: { email: EMAILS.visitor, name: '访客', passwordHash: 'x', role: 'TEMP_VISITOR' } }),
    owner: await prisma.user.create({ data: { email: EMAILS.owner, name: '他人', passwordHash: 'x', role: 'TEMP_VISITOR' } }),
  }

  const mk = async (key: string, followStage: FollowStage, createdById: string, memberUserIds: string[] = []) => {
    const project = await prisma.project.create({
      data: {
        name: `等价-${key}-${SUFFIX}`,
        followStage,
        passedStages: JSON.stringify(['INITIAL_TALK', followStage]),
        totalAmount: '100万',
        targetDate: new Date(),
        createdById,
        members: memberUserIds.length > 0
          ? { create: memberUserIds.map(userId => ({ userId })) }
          : undefined,
      },
    })
    return { key, id: project.id, followStage, createdById, memberIds: memberUserIds }
  }

  seeded = [
    // 1. 他人的公开阶段 → 所有人可见
    await mk('other-initial-talk', 'INITIAL_TALK', users.owner.id),
    // 2. 他人的 REJECTED → canViewProject 兜底放行（全员可见）
    await mk('other-rejected', 'REJECTED', users.owner.id),
    // 3. 他人受限阶段、访客非成员 → 访客不可见
    await mk('other-predd-notmember', 'PRE_DD', users.owner.id),
    // 4. 他人受限阶段、访客是成员 → 可见
    await mk('other-predd-member', 'PRE_DD', users.owner.id, [users.visitor.id]),
    // 5. 访客自己创建的受限阶段、非成员 → 创建者身份不豁免 → 不可见
    await mk('mine-predd-notmember', 'PRE_DD', users.visitor.id),
    // 6. 访客自己创建的公开阶段 → 可见（且属于"我的"）
    await mk('mine-initial-talk', 'INITIAL_TALK', users.visitor.id),
    // 7. 他人交割阶段、访客是成员 → 可见（且属于"我的"）
    await mk('other-closing-member', 'CLOSING', users.owner.id, [users.visitor.id]),
    // 8. 他人立项阶段、经理是成员（特权角色本就全可见）
    await mk('other-initiation-manager-member', 'PROJECT_INITIATION', users.owner.id, [users.manager.id]),
  ]
})

after(async () => {
  await prisma.project.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } })
  await prisma.$disconnect()
})

function idsOf(rows: Array<{ id: string }>): string[] {
  return rows.map(r => r.id).sort()
}

const ROLES: Array<{ name: string; email: string; role: string }> = [
  { name: 'ADMIN', email: EMAILS.admin, role: 'ADMIN' },
  { name: 'INVESTMENT_PARTNER', email: EMAILS.partner, role: 'INVESTMENT_PARTNER' },
  { name: 'INVESTMENT_MANAGER', email: EMAILS.manager, role: 'INVESTMENT_MANAGER' },
  { name: 'TEMP_VISITOR', email: EMAILS.visitor, role: 'TEMP_VISITOR' },
]

test('名单完整性：全集/兜底/开放名单派生关系正确（拦截枚举漂移）', () => {
  // 全集与本地类型定义一致
  assert.deepEqual([...ALL_VIEW_STAGES].sort(), [...ALL_STAGES].sort())
  // 兜底 = 全集 - 公开 - 受限
  const expectedFallback = ALL_STAGES.filter(s => !PUBLIC_STAGES.includes(s) && !RESTRICTED_STAGES.includes(s))
  assert.deepEqual([...FALLBACK_VIEW_STAGES].sort(), [...expectedFallback].sort())
  // 开放可见 = 公开 ∪ 兜底
  assert.deepEqual([...OPEN_VIEW_STAGES].sort(), [...PUBLIC_STAGES, ...expectedFallback].sort())
  // 阶段值互不为子串（passedStages contains 筛选的安全性前提）
  for (const a of ALL_STAGES) {
    for (const b of ALL_STAGES) {
      if (a !== b) {
        assert.ok(!a.includes(b), `阶段值子串冲突：${a} 包含 ${b}，会破坏 contains 筛选`)
      }
    }
  }
})

test('scope=all：DB where 与 canViewProject 逐行过滤完全等价（4 种角色）', async () => {
  const users = await prisma.user.findMany({ where: { email: { in: Object.values(EMAILS) } } })
  const byEmail = new Map(users.map(u => [u.email, u]))

  for (const r of ROLES) {
    const user = byEmail.get(r.email)!
    const permissionUser: PermissionUser = { id: user.id, role: user.role as PermissionUser['role'] }

    const expected = idsOf(seeded.filter(p => canViewProject(permissionUser, p)))
    const rows = await prisma.project.findMany({
      where: buildProjectVisibilityWhere(permissionUser),
      select: { id: true },
    })
    assert.deepEqual(idsOf(rows), expected, `角色 ${r.name} 的 scope=all 不等价`)
  }
})

test('scope=mine：DB where 与 canViewProject ∧ isMaintainedByUser 完全等价（4 种角色）', async () => {
  const users = await prisma.user.findMany({ where: { email: { in: Object.values(EMAILS) } } })
  const byEmail = new Map(users.map(u => [u.email, u]))

  for (const r of ROLES) {
    const user = byEmail.get(r.email)!
    const permissionUser: PermissionUser = { id: user.id, role: user.role as PermissionUser['role'] }

    const expected = idsOf(
      seeded.filter(p => canViewProject(permissionUser, p) && isMaintainedByUser(permissionUser, p))
    )
    const rows = await prisma.project.findMany({
      where: buildProjectScopeWhere(permissionUser, 'mine'),
      select: { id: true },
    })
    assert.deepEqual(idsOf(rows), expected, `角色 ${r.name} 的 scope=mine 不等价`)
  }
})

test('访客可见集合符合业务预期（防止等价但双错的假阳性）', async () => {
  const visitor = await prisma.user.findUnique({ where: { email: EMAILS.visitor } })
  assert.ok(visitor)
  const permissionUser: PermissionUser = { id: visitor.id, role: 'TEMP_VISITOR' }

  const rows = await prisma.project.findMany({
    where: buildProjectVisibilityWhere(permissionUser),
    select: { id: true },
  })
  const visibleKeys = seeded.filter(p => rows.some(r => r.id === p.id)).map(p => p.key).sort()

  assert.deepEqual(visibleKeys, [
    'mine-initial-talk',          // 自己创建的公开阶段
    'other-closing-member',       // 他人受限但我是成员
    'other-initial-talk',         // 他人公开阶段
    'other-predd-member',         // 他人受限且我是成员
    'other-rejected',             // 他人 REJECTED（兜底放行）
  ])
})
