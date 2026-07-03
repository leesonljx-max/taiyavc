import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const email = 'taiyavc@example.com'
  const password = 'taiya2506'
  const name = 'taiyavc'
  const role = 'ADMIN'

  const existingUser = await prisma.user.findUnique({
    where: { email },
  })

  if (existingUser) {
    console.log(`用户 ${email} 已存在，跳过创建`)
    await prisma.$disconnect()
    return
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      role,
    },
  })

  console.log(`✅ 管理员账户创建成功`)
  console.log(`邮箱: ${user.email}`)
  console.log(`用户名: ${user.name}`)
  console.log(`角色: ${user.role}`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('❌ 创建管理员账户失败:', e)
  await prisma.$disconnect()
  process.exit(1)
})