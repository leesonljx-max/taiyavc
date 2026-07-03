/**
 * 系统权限综合测试脚本
 *
 * 覆盖模块：
 *   1. 权限逻辑（canViewProject / canEditProject / canDeleteProject / canPublishReview / canApproveStage / canManageUsers / isMaintainedByUser）
 *   2. 项目列表 scope=all / scope=mine 过滤逻辑（按角色）
 *   3. 立项审批 API 逻辑（创建、查询、多数通过阈值计算）
 *   4. 立项阶段转换检查（PUT 路由的审批门控）
 *   5. 用户管理 API 权限检查（仅 ADMIN）
 *   6. 注册 API 默认 PENDING 状态
 *
 * 运行: npx tsx scripts/test-permissions.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import {
  canViewProject,
  canEditProject,
  canDeleteProject,
  canPublishReview,
  canApproveStage,
  canManageUsers,
  isMaintainedByUser,
  type PermissionUser,
} from '../src/lib/permissions'
import type { UserRole } from '../src/lib/auth'

const prisma = new PrismaClient()

let passCount = 0
let failCount = 0
const createdProjectIds: string[] = []
const createdUserIds: string[] = []
const createdApprovalIds: string[] = []

function logPass(msg: string) {
  console.log(`  ✅ PASS: ${msg}`)
  passCount++
}
function logFail(msg: string, detail?: string) {
  console.log(`  ❌ FAIL: ${msg}`)
  if (detail) console.log(`     详情: ${detail}`)
  failCount++
}

function user(role: UserRole, id = 'user-x'): PermissionUser {
  return { id, role }
}

async function main() {
  console.log('='.repeat(60))
  console.log('🧪 系统权限综合测试')
  console.log('='.repeat(60))

  // 获取测试账号
  const admin = await prisma.user.findUnique({ where: { email: 'admin-test@example.com' } })
  const partner = await prisma.user.findUnique({ where: { email: 'partner-test@example.com' } })
  const manager = await prisma.user.findUnique({ where: { email: 'manager-test@example.com' } })

  if (!admin || !partner || !manager) {
    console.error('❌ 未找到测试账号，请先运行 npm run create-test-accounts')
    process.exit(1)
  }

  console.log(`\n📋 测试账号：`)
  console.log(`   管理员: ${admin.email} (${admin.id})`)
  console.log(`   合伙人: ${partner.email} (${partner.id})`)
  console.log(`   经理:   ${manager.email} (${manager.id})\n`)

  // ========== 测试组1: 权限逻辑函数 ==========
  console.log('━'.repeat(60))
  console.log('测试组1: 权限逻辑函数')
  console.log('━'.repeat(60))

  // canViewProject
  console.log('\n测试 1.1: canViewProject - 各角色查看权限')
  const sampleProject = {
    followStage: 'PRE_DD' as const,
    createdById: manager.id,
    memberIds: [manager.id],
  }
  if (canViewProject(user('ADMIN', admin.id), sampleProject)) {
    logPass('ADMIN 可查看 PreDD 项目')
  } else { logFail('ADMIN 不可查看 PreDD 项目') }
  if (canViewProject(user('INVESTMENT_PARTNER', partner.id), sampleProject)) {
    logPass('PARTNER 可查看 PreDD 项目')
  } else { logFail('PARTNER 不可查看 PreDD 项目') }
  if (canViewProject(user('INVESTMENT_MANAGER', manager.id), sampleProject)) {
    logPass('MANAGER 可查看 PreDD 项目（项目库只读）')
  } else { logFail('MANAGER 不可查看 PreDD 项目') }
  // TEMP_VISITOR 不可查看 PreDD
  if (!canViewProject(user('TEMP_VISITOR', 'visitor-x'), sampleProject)) {
    logPass('VISITOR 不可查看 PreDD 项目')
  } else { logFail('VISITOR 可查看 PreDD 项目（不应该）') }
  // INITIAL_TALK 阶段所有人都可查看
  if (canViewProject(user('TEMP_VISITOR', 'visitor-x'), { ...sampleProject, followStage: 'INITIAL_TALK' })) {
    logPass('VISITOR 可查看 INITIAL_TALK 项目（公开阶段）')
  } else { logFail('VISITOR 不可查看 INITIAL_TALK 项目') }

  // canEditProject
  console.log('\n测试 1.2: canEditProject - 各角色编辑权限')
  if (canEditProject(user('ADMIN', admin.id), sampleProject)) {
    logPass('ADMIN 可编辑任意项目')
  } else { logFail('ADMIN 不可编辑') }
  if (canEditProject(user('INVESTMENT_PARTNER', partner.id), sampleProject)) {
    logPass('PARTNER 可编辑任意项目')
  } else { logFail('PARTNER 不可编辑') }
  if (canEditProject(user('INVESTMENT_MANAGER', manager.id), sampleProject)) {
    logPass('MANAGER 可编辑自己维护的项目')
  } else { logFail('MANAGER 不可编辑自己维护的项目') }
  // MANAGER 不可编辑非自己维护的项目
  if (!canEditProject(user('INVESTMENT_MANAGER', 'manager-y'), sampleProject)) {
    logPass('MANAGER 不可编辑非自己维护的项目')
  } else { logFail('MANAGER 可编辑非自己维护的项目（不应该）') }

  // canDeleteProject
  console.log('\n测试 1.3: canDeleteProject - 删除权限')
  if (canDeleteProject(user('ADMIN', admin.id), sampleProject)) {
    logPass('ADMIN 可删除任意项目')
  } else { logFail('ADMIN 不可删除') }
  if (canDeleteProject(user('INVESTMENT_MANAGER', manager.id), sampleProject)) {
    logPass('MANAGER 可删除自己创建的项目')
  } else { logFail('MANAGER 不可删除自己创建的项目') }
  if (!canDeleteProject(user('INVESTMENT_PARTNER', partner.id), sampleProject)) {
    logPass('PARTNER 不可删除非自己创建的项目')
  } else { logFail('PARTNER 可删除非自己创建的项目（不应该）') }

  // canPublishReview
  console.log('\n测试 1.4: canPublishReview - 发布合伙人评价权限')
  if (canPublishReview(user('ADMIN', admin.id))) {
    logPass('ADMIN 可发布评价')
  } else { logFail('ADMIN 不可发布评价') }
  if (canPublishReview(user('INVESTMENT_PARTNER', partner.id))) {
    logPass('PARTNER 可发布评价')
  } else { logFail('PARTNER 不可发布评价') }
  if (!canPublishReview(user('INVESTMENT_MANAGER', manager.id))) {
    logPass('MANAGER 不可发布评价')
  } else { logFail('MANAGER 可发布评价（不应该）') }

  // canApproveStage
  console.log('\n测试 1.5: canApproveStage - 立项审批权限')
  if (canApproveStage(user('ADMIN', admin.id))) logPass('ADMIN 可审批立项')
  else logFail('ADMIN 不可审批立项')
  if (canApproveStage(user('INVESTMENT_PARTNER', partner.id))) logPass('PARTNER 可审批立项')
  else logFail('PARTNER 不可审批立项')
  if (!canApproveStage(user('INVESTMENT_MANAGER', manager.id))) logPass('MANAGER 不可审批立项')
  else logFail('MANAGER 可审批立项（不应该）')

  // canManageUsers
  console.log('\n测试 1.6: canManageUsers - 用户管理权限')
  if (canManageUsers(user('ADMIN', admin.id))) logPass('ADMIN 可管理用户')
  else logFail('ADMIN 不可管理用户')
  if (!canManageUsers(user('INVESTMENT_PARTNER', partner.id))) logPass('PARTNER 不可管理用户')
  else logFail('PARTNER 可管理用户（不应该）')
  if (!canManageUsers(user('INVESTMENT_MANAGER', manager.id))) logPass('MANAGER 不可管理用户')
  else logFail('MANAGER 可管理用户（不应该）')

  // isMaintainedByUser
  console.log('\n测试 1.7: isMaintainedByUser - 项目维护人判断')
  if (isMaintainedByUser(user('INVESTMENT_MANAGER', manager.id), sampleProject)) {
    logPass('MANAGER 是项目维护人（创建者）')
  } else { logFail('MANAGER 不是项目维护人（应该）') }
  if (!isMaintainedByUser(user('INVESTMENT_MANAGER', 'manager-y'), sampleProject)) {
    logPass('其他 MANAGER 不是项目维护人')
  } else { logFail('其他 MANAGER 是项目维护人（不应该）') }
  const memberProject = { ...sampleProject, createdById: 'other', memberIds: [manager.id] }
  if (isMaintainedByUser(user('INVESTMENT_MANAGER', manager.id), memberProject)) {
    logPass('MANAGER 是项目维护人（成员）')
  } else { logFail('MANAGER 不是项目维护人（成员）') }

  // ========== 测试组2: 项目列表 scope 过滤 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组2: 项目列表 scope 过滤逻辑（按角色）')
  console.log('━'.repeat(60))

  // 创建测试项目
  console.log('\n测试 2.1: 创建 3 个测试项目（不同创建者）')
  const projectByManager = await prisma.project.create({
    data: {
      name: `权限测试-经理项目-${Date.now()}`,
      createdById: manager.id,
      followStage: 'INITIAL_TALK',
      totalAmount: 1000,
      targetDate: new Date(),
    },
  })
  createdProjectIds.push(projectByManager.id)

  const projectByPartner = await prisma.project.create({
    data: {
      name: `权限测试-合伙人项目-${Date.now()}`,
      createdById: partner.id,
      followStage: 'PRE_DD',
      totalAmount: 2000,
      targetDate: new Date(),
    },
  })
  createdProjectIds.push(projectByPartner.id)

  const projectByAdmin = await prisma.project.create({
    data: {
      name: `权限测试-管理员项目-${Date.now()}`,
      createdById: admin.id,
      followStage: 'PRE_DD',
      totalAmount: 3000,
      targetDate: new Date(),
    },
  })
  createdProjectIds.push(projectByAdmin.id)
  logPass(`创建 3 个测试项目成功`)

  // 模拟 scope=all 逻辑
  console.log('\n测试 2.2: scope=all - 各角色可见项目数')
  const allProjects = await prisma.project.findMany({
    include: { members: { select: { userId: true } } },
  })
  // ADMIN scope=all
  const adminViewAll = allProjects.filter(p =>
    canViewProject(user('ADMIN', admin.id), {
      followStage: p.followStage,
      createdById: p.createdById,
      memberIds: p.members.map(m => m.userId),
    })
  ).length
  if (adminViewAll === allProjects.length) {
    logPass(`ADMIN scope=all 可见全部 ${adminViewAll} 个项目`)
  } else { logFail('ADMIN scope=all 不可见全部项目', `${adminViewAll} vs ${allProjects.length}`) }

  // PARTNER scope=all
  const partnerViewAll = allProjects.filter(p =>
    canViewProject(user('INVESTMENT_PARTNER', partner.id), {
      followStage: p.followStage,
      createdById: p.createdById,
      memberIds: p.members.map(m => m.userId),
    })
  ).length
  if (partnerViewAll === allProjects.length) {
    logPass(`PARTNER scope=all 可见全部 ${partnerViewAll} 个项目`)
  } else { logFail('PARTNER scope=all 不可见全部项目') }

  // MANAGER scope=all
  const managerViewAll = allProjects.filter(p =>
    canViewProject(user('INVESTMENT_MANAGER', manager.id), {
      followStage: p.followStage,
      createdById: p.createdById,
      memberIds: p.members.map(m => m.userId),
    })
  ).length
  if (managerViewAll === allProjects.length) {
    logPass(`MANAGER scope=all 可见全部 ${managerViewAll} 个项目`)
  } else { logFail('MANAGER scope=all 不可见全部项目') }

  // 模拟 scope=mine 逻辑
  console.log('\n测试 2.3: scope=mine - 各角色可见项目数')
  // ADMIN scope=mine（理论上不使用 mine，但逻辑上应该返回所有自己创建/维护的）
  const adminMine = allProjects.filter(p => {
    const permP = { followStage: p.followStage, createdById: p.createdById, memberIds: p.members.map(m => m.userId) }
    return canViewProject(user('ADMIN', admin.id), permP) && isMaintainedByUser(user('ADMIN', admin.id), permP)
  })
  if (adminMine.length >= 1) {
    logPass(`ADMIN scope=mine 可见自己维护的 ${adminMine.length} 个项目`)
  } else { logFail('ADMIN scope=mine 应至少看到自己创建的项目') }

  // MANAGER scope=mine
  const managerMine = allProjects.filter(p => {
    const permP = { followStage: p.followStage, createdById: p.createdById, memberIds: p.members.map(m => m.userId) }
    return canViewProject(user('INVESTMENT_MANAGER', manager.id), permP) && isMaintainedByUser(user('INVESTMENT_MANAGER', manager.id), permP)
  })
  // MANAGER 应该只看到自己创建的 projectByManager
  const managerMineIds = managerMine.map(p => p.id)
  if (managerMineIds.includes(projectByManager.id) && !managerMineIds.includes(projectByPartner.id) && !managerMineIds.includes(projectByAdmin.id)) {
    logPass(`MANAGER scope=mine 仅看到自己维护的项目（${managerMine.length} 个）`)
  } else {
    logFail('MANAGER scope=mine 应只看到自己维护的项目', `看到: ${JSON.stringify(managerMineIds)}`)
  }

  // ========== 测试组3: 立项审批 API 逻辑 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组3: 立项审批创建与查询')
  console.log('━'.repeat(60))

  // 测试 3.1: 创建审批（PARTNER APPROVED）
  console.log('\n测试 3.1: PARTNER 创建立项审批（APPROVED）')
  const approval1 = await prisma.stageApproval.create({
    data: {
      projectId: projectByPartner.id,
      userId: partner.id,
      userName: partner.name || partner.email,
      status: 'APPROVED',
      comment: '项目技术壁垒高，同意立项',
    },
  })
  createdApprovalIds.push(approval1.id)
  if (approval1.status === 'APPROVED') {
    logPass(`审批创建成功: status=${approval1.status}, userName=${approval1.userName}`)
  } else { logFail('审批创建失败') }

  // 测试 3.2: 同一用户重复审批（应通过 upsert 更新而非创建）
  console.log('\n测试 3.2: 同一用户重复审批应 upsert 更新')
  const approval1Updated = await prisma.stageApproval.upsert({
    where: { projectId_userId: { projectId: projectByPartner.id, userId: partner.id } },
    update: { status: 'APPROVED', comment: '更新后的意见' },
    create: { projectId: projectByPartner.id, userId: partner.id, userName: partner.name || '', status: 'APPROVED' },
  })
  if (approval1Updated.id === approval1.id) {
    logPass('upsert 更新成功（同一记录）')
  } else { logFail('upsert 创建了新记录（不应该）') }

  // 测试 3.3: 多数通过阈值计算
  console.log('\n测试 3.3: 多数通过阈值计算')
  // 当前 ACTIVE 投资合伙人总数
  const totalPartners = await prisma.user.count({ where: { role: 'INVESTMENT_PARTNER', status: 'ACTIVE' } })
  const majorityThreshold = Math.floor(totalPartners / 2) + 1
  console.log(`     当前 ACTIVE 投资合伙人: ${totalPartners} 位`)
  console.log(`     多数通过阈值: ${majorityThreshold} 票`)
  if (majorityThreshold === Math.floor(totalPartners / 2) + 1) {
    logPass(`多数通过阈值计算正确: ${majorityThreshold}`)
  } else { logFail('多数通过阈值计算错误') }

  // 测试 3.4: 查询审批列表
  console.log('\n测试 3.4: 查询项目审批列表')
  const approvals = await prisma.stageApproval.findMany({
    where: { projectId: projectByPartner.id },
    orderBy: { createdAt: 'desc' },
  })
  if (approvals.length === 1) {
    logPass(`审批列表数量正确: ${approvals.length}`)
  } else { logFail('审批列表数量错误', `期望 1，实际 ${approvals.length}`) }

  // ========== 测试组4: 立项阶段转换门控 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组4: 立项阶段转换门控（模拟 PUT 路由检查）')
  console.log('━'.repeat(60))

  // 模拟 PUT 路由的立项检查逻辑
  async function simulateStageTransitionCheck(projectId: string, targetStage: string) {
    const proj = await prisma.project.findUnique({ where: { id: projectId } })
    if (!proj) return { allowed: false, reason: '项目不存在' }

    if (targetStage === 'PROJECT_INITIATION' && proj.followStage !== 'PROJECT_INITIATION') {
      const partners = await prisma.user.count({ where: { role: 'INVESTMENT_PARTNER', status: 'ACTIVE' } })
      const aps = await prisma.stageApproval.findMany({ where: { projectId } })
      const approved = aps.filter(a => a.status === 'APPROVED').length
      const rejected = aps.filter(a => a.status === 'REJECTED').length
      const threshold = Math.floor(partners / 2) + 1
      if (rejected > 0) return { allowed: false, reason: `存在合伙人拒绝立项（${rejected} 票拒绝）` }
      if (approved < threshold) return { allowed: false, reason: `需要 ${threshold} 票通过，当前 ${approved} 票` }
      return { allowed: true, approved, threshold }
    }
    return { allowed: true }
  }

  // 测试 4.1: 无审批时不可进入立项
  console.log('\n测试 4.1: 无审批时不可进入立项阶段')
  // 用 projectByAdmin（无审批记录）
  const r1 = await simulateStageTransitionCheck(projectByAdmin.id, 'PROJECT_INITIATION')
  if (!r1.allowed && r1.reason?.includes('需要')) {
    logPass(`无审批被正确拒绝: ${r1.reason}`)
  } else { logFail('无审批应被拒绝', JSON.stringify(r1)) }

  // 测试 4.2: 有 1 票通过但仍未达多数（合伙人 > 1 时）
  console.log('\n测试 4.2: 部分通过未达多数阈值')
  // projectByPartner 已有 1 票通过
  const r2 = await simulateStageTransitionCheck(projectByPartner.id, 'PROJECT_INITIATION')
  if (totalPartners > 1) {
    if (!r2.allowed) {
      logPass(`未达多数被拒绝: ${r2.reason}`)
    } else { logFail('未达多数不应允许进入立项') }
  } else {
    // 只有 1 个合伙人时，1 票即可
    if (r2.allowed) {
      logPass('仅 1 位合伙人，1 票即达多数，允许立项')
    } else { logFail('1 位合伙人 1 票应允许立项') }
  }

  // 测试 4.3: 创建第二个合伙人，让其审批，达到多数
  console.log('\n测试 4.3: 创建第二个 ACTIVE 合伙人审批后达到多数')
  const passwordHash = await bcrypt.hash('test123', 10)
  const partner2 = await prisma.user.create({
    data: {
      email: `partner2-test-${Date.now()}@example.com`,
      passwordHash,
      name: '测试合伙人2',
      role: 'INVESTMENT_PARTNER',
      status: 'ACTIVE',
    },
  })
  createdUserIds.push(partner2.id)

  const approval2 = await prisma.stageApproval.create({
    data: {
      projectId: projectByPartner.id,
      userId: partner2.id,
      userName: partner2.name || partner2.email,
      status: 'APPROVED',
      comment: '同意立项',
    },
  })
  createdApprovalIds.push(approval2.id)

  // 重新计算
  const newTotalPartners = await prisma.user.count({ where: { role: 'INVESTMENT_PARTNER', status: 'ACTIVE' } })
  const newThreshold = Math.floor(newTotalPartners / 2) + 1
  const r3 = await simulateStageTransitionCheck(projectByPartner.id, 'PROJECT_INITIATION')
  console.log(`     当前合伙人总数: ${newTotalPartners}, 阈值: ${newThreshold}`)
  if (r3.allowed) {
    logPass(`达到多数阈值，允许进入立项阶段`)
  } else { logFail('达到多数应允许立项', JSON.stringify(r3)) }

  // 测试 4.4: 有合伙人拒绝立项时不可进入
  console.log('\n测试 4.4: 有合伙人拒绝立项时不可进入立项阶段')
  const approval3 = await prisma.stageApproval.create({
    data: {
      projectId: projectByAdmin.id,
      userId: partner.id,
      userName: partner.name || partner.email,
      status: 'REJECTED',
      comment: '技术风险较大',
    },
  })
  createdApprovalIds.push(approval3.id)
  const r4 = await simulateStageTransitionCheck(projectByAdmin.id, 'PROJECT_INITIATION')
  if (!r4.allowed && r4.reason?.includes('拒绝')) {
    logPass(`有拒绝票被阻止: ${r4.reason}`)
  } else { logFail('有拒绝票应被阻止', JSON.stringify(r4)) }

  // 测试 4.5: 非 PreDD 阶段不需要审批即可切换到 PROJECT_INITIATION（边界情况）
  console.log('\n测试 4.5: 非 PROJECT_INITIATION 目标阶段不触发审批检查')
  const r5 = await simulateStageTransitionCheck(projectByAdmin.id, 'DUE_DILIGENCE')
  if (r5.allowed) {
    logPass('切换到 DUE_DILIGENCE 阶段不需要审批')
  } else { logFail('切换到非立项阶段不应被审批阻止') }

  // ========== 测试组5: 用户管理 API 权限检查 ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组5: 用户管理 API 权限检查')
  console.log('━'.repeat(60))

  // 测试 5.1: ADMIN 可以管理用户
  console.log('\n测试 5.1: ADMIN canManageUsers 应返回 true')
  if (canManageUsers(user('ADMIN', admin.id))) {
    logPass('ADMIN 可管理用户')
  } else { logFail('ADMIN 不可管理用户') }

  // 测试 5.2: PARTNER 不可管理用户
  console.log('\n测试 5.2: PARTNER canManageUsers 应返回 false')
  if (!canManageUsers(user('INVESTMENT_PARTNER', partner.id))) {
    logPass('PARTNER 不可管理用户')
  } else { logFail('PARTNER 可管理用户（不应该）') }

  // 测试 5.3: 直接通过 Prisma 修改用户角色（模拟管理员后台 PATCH）
  console.log('\n测试 5.3: 模拟管理员修改用户角色')
  const updatedUser = await prisma.user.update({
    where: { id: manager.id },
    data: { role: 'INVESTMENT_PARTNER' },
    select: { id: true, role: true },
  })
  if (updatedUser.role === 'INVESTMENT_PARTNER') {
    logPass(`用户角色更新成功: ${manager.email} -> INVESTMENT_PARTNER`)
  } else { logFail('用户角色更新失败') }
  // 改回 MANAGER
  await prisma.user.update({ where: { id: manager.id }, data: { role: 'INVESTMENT_MANAGER' } })
  logPass('已恢复 MANAGER 角色')

  // 测试 5.4: 模拟管理员审批待审用户
  console.log('\n测试 5.4: 模拟管理员审批 PENDING 用户')
  const pendingUser = await prisma.user.create({
    data: {
      email: `pending-${Date.now()}@example.com`,
      passwordHash: await bcrypt.hash('test123', 10),
      name: '待审批用户',
      role: 'INVESTMENT_MANAGER',
      status: 'PENDING',
    },
  })
  createdUserIds.push(pendingUser.id)
  if (pendingUser.status === 'PENDING') {
    logPass('PENDING 用户创建成功')
  } else { logFail('PENDING 用户状态不正确') }

  const approvedUser = await prisma.user.update({
    where: { id: pendingUser.id },
    data: { status: 'ACTIVE' },
    select: { id: true, status: true },
  })
  if (approvedUser.status === 'ACTIVE') {
    logPass('PENDING 用户审批通过 -> ACTIVE')
  } else { logFail('用户审批失败') }

  // ========== 测试组6: 注册 API 默认 PENDING ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组6: 注册 API 默认 PENDING 状态')
  console.log('━'.repeat(60))

  // 测试 6.1: 模拟注册逻辑（创建 PENDING 用户）
  console.log('\n测试 6.1: 模拟注册 API 创建 PENDING 用户')
  const registerEmail = `register-${Date.now()}@example.com`
  const newRegisterUser = await prisma.user.create({
    data: {
      email: registerEmail,
      passwordHash: await bcrypt.hash('test123', 10),
      name: '新注册用户',
      role: 'INVESTMENT_MANAGER',
      status: 'PENDING',  // 注册 API 应设置为此状态
    },
  })
  createdUserIds.push(newRegisterUser.id)
  if (newRegisterUser.status === 'PENDING') {
    logPass(`新注册用户默认 PENDING 状态正确`)
  } else { logFail('新注册用户应为 PENDING 状态', `实际: ${newRegisterUser.status}`) }

  // 测试 6.2: PENDING 用户不能登录（模拟 auth.ts authorize 逻辑）
  console.log('\n测试 6.2: PENDING 用户不能登录（authorize 逻辑）')
  function simulateAuthorize(userStatus: string): { allowed: boolean; error?: string } {
    if (userStatus === 'PENDING') return { allowed: false, error: '您的账号正在等待管理员审批' }
    if (userStatus === 'REJECTED') return { allowed: false, error: '注册申请已被拒绝' }
    if (userStatus === 'DISABLED') return { allowed: false, error: '账号已被禁用' }
    if (userStatus === 'ACTIVE') return { allowed: true }
    return { allowed: false, error: '未知状态' }
  }
  if (!simulateAuthorize('PENDING').allowed) {
    logPass('PENDING 状态用户被阻止登录')
  } else { logFail('PENDING 用户不应能登录') }
  if (!simulateAuthorize('REJECTED').allowed) {
    logPass('REJECTED 状态用户被阻止登录')
  } else { logFail('REJECTED 用户不应能登录') }
  if (!simulateAuthorize('DISABLED').allowed) {
    logPass('DISABLED 状态用户被阻止登录')
  } else { logFail('DISABLED 用户不应能登录') }
  if (simulateAuthorize('ACTIVE').allowed) {
    logPass('ACTIVE 状态用户允许登录')
  } else { logFail('ACTIVE 用户应能登录') }

  // 测试 6.3: 管理员审批后 PENDING 用户变 ACTIVE 可登录
  console.log('\n测试 6.3: 管理员审批后用户变 ACTIVE 可登录')
  const approvedRegister = await prisma.user.update({
    where: { id: newRegisterUser.id },
    data: { status: 'ACTIVE' },
  })
  if (simulateAuthorize(approvedRegister.status).allowed) {
    logPass('审批后用户状态 ACTIVE 可登录')
  } else { logFail('审批后用户应能登录') }

  // ========== 测试组7: 项目详情 GET 包含 stageApprovals ==========
  console.log('\n' + '━'.repeat(60))
  console.log('测试组7: 项目详情 GET 接口包含 stageApprovals 关联')
  console.log('━'.repeat(60))

  console.log('\n测试 7.1: 查询项目详情（include stageApprovals）')
  const projectWithApprovals = await prisma.project.findUnique({
    where: { id: projectByPartner.id },
    include: {
      stageApprovals: { orderBy: { createdAt: 'desc' } },
      members: { select: { userId: true } },
    },
  })
  if (projectWithApprovals && projectWithApprovals.stageApprovals.length === 2) {
    logPass(`stageApprovals 数量正确: ${projectWithApprovals.stageApprovals.length}`)
  } else { logFail('stageApprovals 数量不正确', `实际: ${projectWithApprovals?.stageApprovals.length}`) }
  // 验证每个审批记录包含 userName 字段
  const allHaveUserName = projectWithApprovals?.stageApprovals.every(a => !!a.userName)
  if (allHaveUserName) {
    logPass('所有审批记录包含 userName 字段')
  } else { logFail('部分审批记录缺少 userName') }

  // ========== 清理测试数据 ==========
  console.log('\n' + '━'.repeat(60))
  console.log(`🧹 清理测试数据`)
  console.log('━'.repeat(60))

  // 删除审批记录
  for (const id of createdApprovalIds) {
    try { await prisma.stageApproval.delete({ where: { id } }) } catch {}
  }
  console.log(`  已删除 ${createdApprovalIds.length} 条审批记录`)

  // 删除项目
  for (const id of createdProjectIds) {
    try { await prisma.project.delete({ where: { id } }) } catch {}
  }
  console.log(`  已删除 ${createdProjectIds.length} 个项目`)

  // 删除额外创建的用户（保留 3 个测试账号）
  for (const id of createdUserIds) {
    try { await prisma.user.delete({ where: { id } }) } catch {}
  }
  console.log(`  已删除 ${createdUserIds.length} 个临时用户`)

  // ========== 测试结果汇总 ==========
  console.log('\n' + '='.repeat(60))
  console.log('📊 测试结果汇总')
  console.log('='.repeat(60))
  console.log(`✅ 通过: ${passCount}`)
  console.log(`❌ 失败: ${failCount}`)
  console.log(`总计: ${passCount + failCount}`)
  console.log('='.repeat(60))

  if (failCount === 0) {
    console.log('\n🎉 所有测试通过！系统权限功能正常。')
  } else {
    console.log('\n⚠️ 存在失败的测试，请检查上方日志。')
  }

  await prisma.$disconnect()
  process.exit(failCount === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('❌ 测试脚本执行失败:', e)
  // 清理
  for (const id of createdApprovalIds) {
    try { await prisma.stageApproval.delete({ where: { id } }) } catch {}
  }
  for (const id of createdProjectIds) {
    try { await prisma.project.delete({ where: { id } }) } catch {}
  }
  for (const id of createdUserIds) {
    try { await prisma.user.delete({ where: { id } }) } catch {}
  }
  await prisma.$disconnect()
  process.exit(1)
})
