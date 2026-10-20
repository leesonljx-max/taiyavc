'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { applyTheme, THEME_STORAGE_KEY } from '@/lib/themes'

/**
 * 挂载在根布局：登录后从服务器读取账户主题并应用。
 * 首屏已由 <body> 顶部的内联脚本从 localStorage 提前应用（防闪色），
 * 此处负责跨设备一致（换浏览器/设备登录后仍是账户保存的主题）。
 */
export default function ThemeSync() {
  const { status } = useSession()

  useEffect(() => {
    if (status !== 'authenticated') return
    fetch('/api/user/theme')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.themeId) {
          applyTheme(data.themeId)
          localStorage.setItem(THEME_STORAGE_KEY, data.themeId)
        }
      })
      .catch(() => { /* 网络失败时保留 localStorage 主题 */ })
  }, [status])

  return null
}
