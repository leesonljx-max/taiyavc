'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import ProfileEditModal from './ProfileEditModal'
import packageJson from '../../package.json'

const APP_VERSION = `v${packageJson.version}`

const navItems = [
  { href: '/', label: '首页', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { href: '/projects', label: '项目库', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { href: '/workbench', label: '工作台', icon: 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2' },
  { href: '/research', label: '项目尽调', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { href: '/ai-research', label: 'AI行研', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
  { href: '/statistics', label: '统计分析', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { href: '/news', label: 'AI 看板', icon: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z' },
]

// 管理员专用导航
const adminNavItems = [
  { href: '/admin/users', label: '管理员后台', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z' },
]

interface DashboardLayoutProps {
  children: React.ReactNode
  title?: string
  subtitle?: string
  actions?: React.ReactNode
}

export default function DashboardLayout({ children, title, subtitle, actions }: DashboardLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session, update: updateSession } = useSession()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileModalOpen, setProfileModalOpen] = useState(false)

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  const isAdmin = session?.user?.role === 'ADMIN'
  const allNavItems = isAdmin ? [...navItems, ...adminNavItems] : navItems

  // 项目尽调栏目主题：进入 /research 路径时侧边栏与导航变为紫蓝色（B6B1EE）
  const isDDTheme = pathname.startsWith('/research')

  return (
    <div className={`min-h-screen bg-gradient-primary ${isDDTheme ? 'dd-theme' : ''}`}>
      {/* Sidebar - 固定冻结，不随页面滚动而变动 */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 ${isDDTheme ? 'dd-theme-sidebar' : 'bg-gradient-sidebar'} border-r ${isDDTheme ? 'border-[#d8d2f0]' : 'border-primary-100'} shadow-[6px_0_16px_rgba(26,111,245,0.08)] transform transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center gap-3 px-6 py-5 border-b border-primary-100">
            <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shadow-lg shadow-primary-500/30 bg-gradient-to-br from-primary-500 to-primary-700">
              {/* 将 logo 图片命名为 logo.png 放到 public 目录即可替换 */}
              <Image
                src="/logo.png"
                alt="泰亚投资 logo"
                width={40}
                height={40}
                className="w-full h-full object-cover"
                priority
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-gray-900">泰亚投资</span>
                <span className="text-[10px] font-medium text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded-md border border-primary-100">
                  {APP_VERSION}
                </span>
              </div>
              <div className="text-xs text-gray-500">投资管理平台</div>
            </div>
          </div>

          {/* Navigation - 3D 栏目框样式（等高、带阴影、切换动画） */}
          <nav className="flex-1 px-3 py-4 flex flex-col gap-2.5 overflow-y-auto">
            {allNavItems.map((item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`nav-block group flex items-center gap-3 px-4 h-[52px] rounded-xl select-none ${active ? 'nav-block-active' : ''}`}
                >
                  <svg className={`w-5 h-5 flex-shrink-0 transition-transform duration-300 group-hover:scale-110 ${active ? 'text-white' : 'text-primary-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                  </svg>
                  <span className="text-sm font-medium flex-1">{item.label}</span>
                  {active && (
                    <span className="w-2 h-2 rounded-full bg-white/95 shadow-[0_0_8px_rgba(255,255,255,0.9)] animate-pulse" />
                  )}
                </Link>
              )
            })}
          </nav>

          {/* User info */}
          <div className="px-3 py-4 border-t border-primary-100">
            {session ? (
              <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-primary-50">
                <button
                  onClick={() => setProfileModalOpen(true)}
                  className="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-medium text-sm flex-shrink-0 ring-2 ring-white hover:ring-primary-300 transition-all cursor-pointer"
                  title="点击修改个人信息"
                >
                  {session.user?.avatar ? (
                    <Image src={session.user.avatar} alt="头像" width={36} height={36} className="w-full h-full object-cover" unoptimized />
                  ) : (
                    session.user?.name?.charAt(0).toUpperCase() || 'U'
                  )}
                </button>
                <button
                  onClick={() => setProfileModalOpen(true)}
                  className="flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
                  title="点击修改个人信息"
                >
                  <div className="text-sm font-medium text-gray-900 truncate">{session.user?.name || '用户'}</div>
                  <div className="text-xs text-gray-500 truncate">{session.user?.email}</div>
                </button>
                <button
                  onClick={async () => {
                    await signOut({ redirect: false })
                    router.push('/auth/login')
                  }}
                  className="text-gray-400 hover:text-danger-600 transition-colors flex-shrink-0"
                  title="退出登录"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            ) : (
              <Link
                href="/auth/login"
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 transition-colors"
              >
                登录
              </Link>
            )}
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content（桌面端左侧留出侧边栏宽度，侧边栏冻结不滚动） */}
      <div className="flex flex-col min-h-screen min-w-0 lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 glass border-b border-primary-100">
          <div className="flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden text-gray-600 hover:text-primary-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div>
                {title && <h1 className="text-xl font-bold text-gray-900">{title}</h1>}
                {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
              </div>
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
        </header>

        {/* Page content（key 触发路由切换时的淡入上移动画） */}
        <main key={pathname} className="flex-1 p-6 page-enter">
          {children}
        </main>
      </div>

      {/* 个人设置弹窗 */}
      <ProfileEditModal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        onUpdate={async () => { await updateSession() }}
      />
    </div>
  )
}
