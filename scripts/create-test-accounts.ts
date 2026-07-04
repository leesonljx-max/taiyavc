/**
 * 创建 3 种角色测试账号：
 * - 管理员: admin-test@example.com / admin123
 * - 投资合伙人: partner-test@example.com / partner123
 * - 投资经理: manager-test@example.com / manager123
 *
 * 注意：所有测试账号默认 status=ACTIVE，可直接登录
 * 运行: npx tsx scripts/create-test-accounts.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

interface AccountSpec {
  email: string
  password: string
  name: string
  role: string
}

const accounts: AccountSpec[] = [
  { email: 'admin-test@example.com', password: 'admin123', name: '测试管理员', role: 'ADMIN' },
  { email: 'partner-test@example.com', password: 'partner123', name: '测试合伙人', role: 'INVESTMENT_PARTNER' },
  { email: 'manager-test@example.com', password: 'manager123', name: '测试经理', role: 'INVESTMENT_MANAGER' },
]

async function main() {
  console.log('='.repeat(60))
  console.log('👤 创建 3 种角色测试账号')
  console.log('='.repeat(60))

  for (const spec of accounts) {
    const existing = await prisma.user.findUnique({ where: { email: spec.email } })
    if (existing) {
      // 已存在则更新角色和状态为 ACTIVE
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: { role: spec.role, status: 'ACTIVE', name: spec.name },
      })
      console.log(`✓ 已存在并更新: ${updated.email} (${updated.role}) [${updated.status}]`)
      continue
    }

    const passwordHash = await bcrypt.hash(spec.password, 12)
    const user = await prisma.user.create({
      data: {
        email: spec.email,
        passwordHash,
        name: spec.name,
        role: spec.role,
        status: 'ACTIVE',
      },
    })
    console.log(`✓ 创建成功: ${user.email} / ${spec.password} (${user.role}) [${user.status}]`)
  }

  console.log('\n📋 测试账号清单：')
  console.log('━'.repeat(60))
  console.log('管理员账号:    admin-test@example.com / admin123')
  console.log('投资合伙人账号: partner-test@example.com / partner123')
  console.log('投资经理账号:   manager-test@example.com / manager123')
  console.log('━'.repeat(60))

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('❌ 创建测试账号失败:', e)
  await prisma.$disconnect()
  process.exit(1)
})
