import NextAuth from 'next-auth'
import type { UserRole } from '@/lib/auth'

declare module 'next-auth' {
  interface User {
    role: UserRole
  }

  interface Session {
    user: {
      id: string
      email: string
      name?: string
      role: UserRole
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: UserRole
    name?: string
  }
}
