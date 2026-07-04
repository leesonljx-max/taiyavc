import NextAuth, { type NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import prisma from './prisma'
import bcrypt from 'bcryptjs'

export type UserRole = 'ADMIN' | 'INVESTMENT_MANAGER' | 'INVESTMENT_PARTNER' | 'POST_INVESTMENT_OFFICER' | 'TEMP_VISITOR'

export const roleLabels: Record<UserRole, string> = {
  ADMIN: '管理员',
  INVESTMENT_MANAGER: '投资经理',
  INVESTMENT_PARTNER: '投资合伙人',
  POST_INVESTMENT_OFFICER: '投后专员',
  TEMP_VISITOR: '临时访客',
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      credentials: {
        email: { label: '账户名或邮箱', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const loginInput = credentials.email.trim()

        // 支持以账户名（username）或邮箱（email）登录
        // 如果输入包含 @，按邮箱查询；否则按账户名查询
        let user
        if (loginInput.includes('@')) {
          user = await prisma.user.findUnique({
            where: { email: loginInput },
          })
        } else {
          user = await prisma.user.findUnique({
            where: { username: loginInput },
          })
        }

        if (!user) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        )

        if (!isPasswordValid) {
          return null
        }

        // 检查用户状态：PENDING 用户需管理员审批后才能登录
        if (user.status === 'PENDING') {
          throw new Error('您的账号正在等待管理员审批，审批通过后方可登录')
        }
        if (user.status === 'REJECTED') {
          throw new Error('您的注册申请已被拒绝，请联系管理员')
        }
        if (user.status === 'DISABLED') {
          throw new Error('您的账号已被禁用，请联系管理员')
        }

        const validRoles = ['ADMIN', 'INVESTMENT_PARTNER', 'INVESTMENT_MANAGER', 'POST_INVESTMENT_OFFICER', 'TEMP_VISITOR']
        const userRole = validRoles.includes(user.role) ? user.role : 'TEMP_VISITOR'

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: userRole as UserRole,
          avatar: user.avatar,
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production' ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id
        token.role = (user as { role: UserRole }).role
        token.name = user.name ?? undefined
        token.avatar = (user as { avatar?: string | null }).avatar ?? undefined
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.name = token.name as string | undefined
        session.user.avatar = token.avatar as string | undefined
        // 校验 role
        const validRoles = ['ADMIN', 'INVESTMENT_PARTNER', 'INVESTMENT_MANAGER', 'POST_INVESTMENT_OFFICER', 'TEMP_VISITOR']
        if (!validRoles.includes(session.user.role as string)) {
          session.user.role = 'TEMP_VISITOR'
        }
      }
      return session
    },
  },
  pages: {
    signIn: '/auth/login',
  },
}

export default NextAuth(authOptions)
