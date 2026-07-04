'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

const inputClass = "w-full px-4 py-2.5 bg-white/80 border border-primary-200 rounded-xl focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition-all-smooth placeholder-gray-400"
const labelClass = "block text-sm font-medium text-gray-700 mb-2"

export default function RegisterPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!formData.name || !formData.username || !formData.email || !formData.password) {
      setError('所有字段均为必填项')
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    if (formData.password.length < 6) {
      setError('密码长度至少 6 位')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || '注册失败')
        return
      }

      setSuccess(true)
    } catch (error) {
      setError('注册失败，请检查网络连接')
    }
    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">注册成功</h2>
          <p className="text-gray-600 mb-6">
            您的账号正在等待管理员审批，审批通过后方可登录。请联系管理员加快审批流程。
          </p>
          <button
            onClick={() => router.push('/auth/login')}
            className="w-full px-4 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all-smooth font-medium"
          >
            返回登录
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8">
        {/* 标题 */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl overflow-hidden flex items-center justify-center shadow-lg shadow-primary-500/30 bg-gradient-to-br from-primary-500 to-primary-600">
            {/* 登录/注册页专用 logo：将图片命名为 logo-auth.png 放到 public 目录 */}
            <Image
              src="/logo-auth.png"
              alt="泰亚投资 logo"
              width={56}
              height={56}
              className="w-full h-full object-cover"
              priority
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">注册账号</h1>
          <p className="text-sm text-gray-500 mt-1">填写信息提交注册，等待管理员审批</p>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 bg-danger-50 border border-danger-200 rounded-xl text-sm text-danger-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>姓名 <span className="text-danger-500">*</span></label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className={inputClass}
              placeholder="请输入您的姓名"
            />
          </div>

          <div>
            <label className={labelClass}>账户名 <span className="text-danger-500">*</span></label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
              className={inputClass}
              placeholder="用于登录，如：zhangsan"
            />
            <p className="text-xs text-gray-400 mt-1">可使用字母、数字、下划线，登录时填写此项或邮箱</p>
          </div>

          <div>
            <label className={labelClass}>邮箱 <span className="text-danger-500">*</span></label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              className={inputClass}
              placeholder="请输入邮箱地址"
            />
          </div>

          <div>
            <label className={labelClass}>密码 <span className="text-danger-500">*</span></label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
              className={inputClass}
              placeholder="至少 6 位"
            />
          </div>

          <div>
            <label className={labelClass}>确认密码 <span className="text-danger-500">*</span></label>
            <input
              type="password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
              className={inputClass}
              placeholder="请再次输入密码"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2.5 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:from-primary-600 hover:to-primary-700 transition-all-smooth font-medium disabled:opacity-50"
          >
            {loading ? '提交中...' : '提交注册'}
          </button>
        </form>

        <div className="text-center mt-6">
          <p className="text-sm text-gray-500">
            已有账号？{' '}
            <Link href="/auth/login" className="font-medium text-primary-600 hover:text-primary-700 transition-colors">
              返回登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
