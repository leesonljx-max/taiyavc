import NextAuth from 'next-auth'
import type { UserRole } from '@/lib/auth'

declare module 'next-auth' {
  interface User {
    role: UserRole
    avatar?: string | null
  }

  interface Session {
    user: {
      id: string
      email: string
      name?: string
      role: UserRole
      avatar?: string
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: UserRole
    name?: string
    avatar?: string
  }
}
