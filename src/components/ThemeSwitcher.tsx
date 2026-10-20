'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { THEMES, applyTheme, THEME_STORAGE_KEY, DEFAULT_THEME_ID, getThemeById } from '@/lib/themes'

/**
 * 切换主题（仅首页右上角、头像左侧）：
 * 弹层以色卡形式展示纯色 + 渐变模版，点选即生效，
 * 同时写入 localStorage（下次访问保持）与账户（跨设备保持）
 */
export default function ThemeSwitcher() {
  const { status } = useSession()
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string>(DEFAULT_THEME_ID)

  // 初始：localStorage 即时回显
  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved) setActiveId(saved)
  }, [])

  // 登录后以服务器保存的账户主题为准
  useEffect(() => {
    if (status !== 'authenticated') return
    fetch('/api/user/theme')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.themeId) setActiveId(data.themeId)
      })
      .catch(() => {})
  }, [status])

  const pick = (id: string) => {
    setActiveId(id)
    applyTheme(id)
    localStorage.setItem(THEME_STORAGE_KEY, id)
    setOpen(false)
    // 保存到账户（失败不阻塞：本地已生效，下次打开弹层仍会同步）
    fetch('/api/user/theme', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId: id }),
    }).catch(() => {})
  }

  const solids = THEMES.filter(t => t.type === 'solid')
  const gradients = THEMES.filter(t => t.type === 'gradient')

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="h-9 px-3 rounded-full flex items-center gap-1.5 bg-surface/80 border border-hairline text-sm font-medium text-ink hover:bg-surface transition-colors shadow-soft"
        title="切换主题"
      >
        <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
        切换主题
      </button>

      {open && (
        <>
          {/* 点击外部关闭 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-[320px] bg-surface rounded-2xl shadow-soft-lg border border-hairline p-4 max-h-[72vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-bold text-ink">选择底色</p>
                <p className="text-[10px] text-ink-faint mt-0.5">当前：{getThemeById(activeId).label} · 保存到账户，下次访问自动应用</p>
              </div>
              {activeId !== DEFAULT_THEME_ID && (
                <button
                  onClick={() => pick(DEFAULT_THEME_ID)}
                  className="px-2 py-1 rounded-full text-[10px] font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 transition-colors flex-shrink-0"
                >
                  恢复默认
                </button>
              )}
            </div>

            {/* 纯色色卡 */}
            <p className="text-xs font-bold text-ink-muted mb-2">纯色</p>
            <div className="grid grid-cols-6 gap-2 mb-4">
              {solids.map(theme => {
                const isActive = theme.id === activeId
                return (
                  <button
                    key={theme.id}
                    onClick={() => pick(theme.id)}
                    title={theme.label}
                    style={{ background: theme.css }}
                    className={`relative w-9 h-9 rounded-xl border border-black/10 transition-transform hover:scale-110 flex items-center justify-center ${isActive ? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-surface' : ''}`}
                  >
                    {isActive && (
                      <svg className="w-4 h-4 text-white drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>

            {/* 渐变色卡 */}
            <p className="text-xs font-bold text-ink-muted mb-2">渐变</p>
            <div className="grid grid-cols-4 gap-2">
              {gradients.map(theme => {
                const isActive = theme.id === activeId
                return (
                  <button key={theme.id} onClick={() => pick(theme.id)} title={theme.label} className="group">
                    <div
                      style={{ background: theme.css }}
                      className={`h-11 rounded-xl border border-black/10 transition-transform group-hover:scale-105 flex items-center justify-center ${isActive ? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-surface' : ''}`}
                    >
                      {isActive && (
                        <svg className="w-4 h-4 text-white drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <p className={`text-[10px] text-center mt-1 truncate ${isActive ? 'text-primary-700 font-bold' : 'text-ink-muted'}`}>{theme.label}</p>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
