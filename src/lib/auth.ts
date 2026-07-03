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
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        })

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

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as UserRole,
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: UserRole }).role
        token.name = user.name ?? undefined
      }
      return token
    },
    async session({ session, token }) {
      session.user.role = token.role as UserRole
      session.user.name = token.name as string | undefined
      return session
    },
  },
  pages: {
    signIn: '/auth/login',
  },
}

export default NextAuth(authOptions)
