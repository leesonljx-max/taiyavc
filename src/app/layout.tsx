import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Providers from './providers'
import ThemeSync from '@/components/ThemeSync'
import { buildThemeBootstrapScript } from '@/lib/themes'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '泰亚投资 - 投资项目管理平台',
  description: '专业的投资项目管理平台，帮助您高效管理投资组合',
  manifest: '/manifest.json',
  icons: {
    icon: '/icons/favicon-32.png',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '泰亚投资',
  },
}

export const viewport: Viewport = {
  themeColor: '#ECE3D4',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        {/* 首屏防闪色：绘制前从 localStorage 恢复用户主题（CSS 变量） */}
        <script dangerouslySetInnerHTML={{ __html: buildThemeBootstrapScript() }} />
        <Providers>
          {/* 登录后从账户同步主题（跨设备一致） */}
          <ThemeSync />
          {children}
        </Providers>
      </body>
    </html>
  )
}
