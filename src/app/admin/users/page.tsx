'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import DashboardLayout from '@/components/DashboardLayout'
import { roleLabels, type UserRole } from '@/lib/auth'

interface User {
  id: string
  email: string
  username: string | null
  name: string | null
  role: string
  status: string
  createdAt: string
  updatedAt: string
}

const statusLabels: Record<string, string> = {
  ACTIVE: '已激活',
  PENDING: '待审批',
  REJECTED: '已拒绝',
  DISABLED: '已禁用',
}

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  PENDING: 'bg-amber-100 text-amber-700',
  REJECTED: 'bg-danger-100 text-danger-700',
  DISABLED: 'bg-gray-100 text-gray-700',
}

const roleColors: Record<string, string> = {
  ADMIN: 'bg-purple-100 text-purple-700',
  INVESTMENT_PARTNER: 'bg-blue-100 text-blue-700',
  INVESTMENT_MANAGER: 'bg-cyan-100 text-cyan-700',
  POST_INVESTMENT_OFFICER: 'bg-indigo-100 text-indigo-700',
  TEMP_VISITOR: 'bg-gray-100 text-gray-700',
}

export default function AdminUsersPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'disabled'>('all')
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editRole, setEditRole] = useState<string>('')
  const [editStatus, setEditStatus] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login?callbackUrl=/admin/users')
    }
    if (session && session.user.role !== 'ADMIN') {
      router.push('/')
    }
  }, [status, session, router])

  useEffect(() => {
    if (session?.user?.role === 'ADMIN') {
      fetchUsers()
    }
  }, [session])

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/users')
      if (!response.ok) {
        const data = await response.json()
        setError(data.error || '获取用户列表失败')
        return
      }
      const data = await response.json()
      setUsers(data.users || [])
      setPendingCount(data.pendingCount || 0)
    } catch (error) {
      setError('获取用户列表失败')
    }
    setLoading(false)
  }

  const handleUpdateUser = async (userId: string, role: string, status: string) => {
    setIsSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, role, status }),
      })
      if (!response.ok) {
        const data = await response.json()
        setError(data.error || '更新失败')
        return
      }
      setEditingUser(null)
      await fetchUsers()
    } catch (error) {
      setError('更新用户失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  const filteredUsers = users.filter(u => {
    if (filter === 'pending') return u.status === 'PENDING'
    if (filter === 'active') return u.status === 'ACTIVE'
    if (filter === 'disabled') return u.status === 'DISABLED' || u.status === 'REJECTED'
    return true
  })

  if (status === 'loading' || !session) {
    return (
      <DashboardLayout title="管理员后台">
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      </DashboardLayout>
    )
  }

  if (session.user.role !== 'ADMIN') {
    return (
      <DashboardLayout title="管理员后台">
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">无权访问</h3>
            <p className="text-gray-500">仅管理员可访问后台</p>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout
      title="管理员后台"
      subtitle="账号管理 / 注册审批 / 权限分配"
    >
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
          <div className="text-2xl font-bold text-gray-900">{users.length}</div>
          <div className="text-xs text-gray-500">总用户数</div>
        </div>
        <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
          <div className="text-2xl font-bold text-amber-600">{pendingCount}</div>
          <div className="text-xs text-gray-500">待审批</div>
        </div>
        <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
          <div className="text-2xl font-bold text-emerald-600">
            {users.filter(u => u.status === 'ACTIVE').length}
          </div>
          <div className="text-xs text-gray-500">已激活</div>
        </div>
        <div className="bg-gradient-card rounded-2xl p-5 shadow-sm border border-primary-100">
          <div className="text-2xl font-bold text-purple-600">
            {users.filter(u => u.role === 'ADMIN').length}
          </div>
          <div className="text-xs text-gray-500">管理员</div>
        </div>
      </div>

      {/* 筛选 */}
      <div className="bg-gradient-card rounded-2xl shadow-sm p-1.5 mb-6 border border-primary-100 inline-flex">
        {([
          { key: 'all', label: '全部' },
          { key: 'pending', label: `待审批 (${pendingCount})` },
          { key: 'active', label: '已激活' },
          { key: 'disabled', label: '已禁用/拒绝' },
        ] as const).map(item => (
          <button
            key={item.key}
            onClick={() => setFilter(item.key)}
            className={`px-5 py-2 rounded-xl text-sm font-medium transition-all-smooth ${
              filter === item.key
                ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md shadow-primary-500/30'
                : 'text-gray-600 hover:bg-primary-50 hover:text-primary-700'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-danger-50 border border-danger-200 rounded-xl text-sm text-danger-700">
          {error}
        </div>
      )}

      {/* 用户列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      ) : (
        <div className="bg-gradient-card rounded-2xl shadow-sm border border-primary-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-primary-50/50 border-b border-primary-100">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase">用户</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase">账户名</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase">邮箱</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase">角色</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase">状态</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-600 uppercase">注册时间</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-600 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary-50">
                {filteredUsers.map(user => (
                  <tr key={user.id} className="hover:bg-primary-50/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-medium text-sm">
                          {(user.name || user.email).charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-900 text-sm">{user.name || '-'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{user.username || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[user.role] || 'bg-gray-100 text-gray-700'}`}>
                        {roleLabels[user.role as UserRole] || user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[user.status] || 'bg-gray-100 text-gray-700'}`}>
                        {statusLabels[user.status] || user.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(user.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingUser?.id === user.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <select
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value)}
                            className="text-xs px-2 py-1 border border-primary-200 rounded-lg bg-white"
                          >
                            {Object.entries(roleLabels).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                          <select
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value)}
                            className="text-xs px-2 py-1 border border-primary-200 rounded-lg bg-white"
                          >
                            <option value="ACTIVE">已激活</option>
                            <option value="PENDING">待审批</option>
                            <option value="REJECTED">已拒绝</option>
                            <option value="DISABLED">已禁用</option>
                          </select>
                          <button
                            onClick={() => handleUpdateUser(user.id, editRole, editStatus)}
                            disabled={isSubmitting}
                            className="px-3 py-1 bg-emerald-500 text-white text-xs rounded-lg hover:bg-emerald-600 disabled:opacity-50"
                          >
                            保存
                          </button>
                          <button
                            onClick={() => setEditingUser(null)}
                            className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          {user.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => handleUpdateUser(user.id, user.role, 'ACTIVE')}
                                className="px-3 py-1 bg-emerald-500 text-white text-xs rounded-lg hover:bg-emerald-600"
                              >
                                通过
                              </button>
                              <button
                                onClick={() => handleUpdateUser(user.id, user.role, 'REJECTED')}
                                className="px-3 py-1 bg-danger-500 text-white text-xs rounded-lg hover:bg-danger-600"
                              >
                                拒绝
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => {
                              setEditingUser(user)
                              setEditRole(user.role)
                              setEditStatus(user.status)
                            }}
                            className="px-3 py-1 bg-primary-50 text-primary-700 text-xs rounded-lg hover:bg-primary-100"
                          >
                            编辑
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">
                      暂无用户
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
