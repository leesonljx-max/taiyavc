import { PrismaClient } from '@prisma/client'

// 全局单例：避免开发环境 HMR 和生产环境多实例下重复创建 PrismaClient
const globalForPrisma = global as unknown as { prisma: PrismaClient | undefined }

const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: ['error', 'warn'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
