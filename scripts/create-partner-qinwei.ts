/**
 * 创建投资合伙人账号：秦伟
 * - 邮箱: qinwei@taiya.com
 * - 密码: qinwei
 * - 姓名: 秦伟
 *
 * 运行: npx tsx scripts/create-partner-qinwei.ts
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const email = 'qinwei@taiya.com'
  const password = 'qinwei'
  const name = '秦伟'
  const role = 'INVESTMENT_PARTNER'

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { role, status: 'ACTIVE', name },
    })
    console.log(`✓ 已存在并更新: ${updated.email} | ${updated.name} | ${updated.role} | ${updated.status}`)
  } else {
    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { email, passwordHash, name, role, status: 'ACTIVE' },
    })
    console.log(`✓ 创建成功: ${user.email} | ${user.name} | ${user.role} | ${user.status}`)
    console.log(`  密码: ${password}`)
  }

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('❌ 创建失败:', e)
  await prisma.$disconnect()
  process.exit(1)
})
