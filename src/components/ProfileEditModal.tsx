'use client'

import { useState, useRef } from 'react'
import { useSession } from 'next-auth/react'
import Image from 'next/image'
import AvatarCropper from './AvatarCropper'

interface ProfileEditModalProps {
  open: boolean
  onClose: () => void
  onUpdate: () => void
}

export default function ProfileEditModal({ open, onClose, onUpdate }: ProfileEditModalProps) {
  const { data: session, update: updateSession } = useSession()
  const [tab, setTab] = useState<'info' | 'password' | 'avatar'>('info')

  // 信息 tab
  const [name, setName] = useState(session?.user?.name || '')
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoError, setInfoError] = useState('')
  const [infoSuccess, setInfoSuccess] = useState('')

  // 密码 tab
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwdLoading, setPwdLoading] = useState(false)
  const [pwdError, setPwdError] = useState('')
  const [pwdSuccess, setPwdSuccess] = useState('')

  // 头像 tab
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [rawFile, setRawFile] = useState<File | null>(null)  // 原始未裁剪的文件
  const [showCropper, setShowCropper] = useState(false)
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [avatarSuccess, setAvatarSuccess] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  const handleSaveInfo = async () => {
    setInfoLoading(true)
    setInfoError('')
    setInfoSuccess('')
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) {
        setInfoError(data.error || '保存失败')
        return
      }
      setInfoSuccess('姓名修改成功')
      // 通过 updateSession 主动更新 JWT token 中的 name
      await updateSession({ name })
      onUpdate()
    } catch {
      setInfoError('网络错误')
    } finally {
      setInfoLoading(false)
    }
  }

  const handleChangePassword = async () => {
    setPwdLoading(true)
    setPwdError('')
    setPwdSuccess('')
    if (newPassword !== confirmPassword) {
      setPwdError('两次输入的新密码不一致')
      setPwdLoading(false)
      return
    }
    try {
      const res = await fetch('/api/user/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPwdError(data.error || '修改失败')
        return
      }
      setPwdSuccess('密码修改成功')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      setPwdError('网络错误')
    } finally {
      setPwdLoading(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('图片不能超过 5MB')
      return
    }
    setAvatarError('')
    setAvatarSuccess('')
    setRawFile(file)
    setShowCropper(true)
  }

  // 裁剪完成回调
  const handleCropComplete = (croppedFile: File) => {
    setAvatarFile(croppedFile)
    const reader = new FileReader()
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string)
    reader.readAsDataURL(croppedFile)
    setShowCropper(false)
  }

  // 裁剪取消回调
  const handleCropCancel = () => {
    setShowCropper(false)
    setRawFile(null)
  }

  const handleUploadAvatar = async () => {
    if (!avatarFile) return
    setAvatarLoading(true)
    setAvatarError('')
    setAvatarSuccess('')
    try {
      const formData = new FormData()
      formData.append('file', avatarFile)
      const res = await fetch('/api/user/avatar', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        setAvatarError(data.error || '上传失败')
        return
      }
      setAvatarSuccess('头像更新成功')
      // 关键修复：通过 updateSession 主动更新 JWT token 中的 avatar
      // JWT 策略下，updateSession() 默认不会从 DB 重新加载，需要显式传值
      await updateSession({ avatar: data.avatar })
      onUpdate()
    } catch {
      setAvatarError('网络错误')
    } finally {
      setAvatarLoading(false)
    }
  }

  const currentAvatar = session?.user?.avatar
  const displayName = session?.user?.name || '用户'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">个人设置</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-gray-100 px-6">
          {([
            { key: 'info', label: '修改姓名' },
            { key: 'password', label: '修改密码' },
            { key: 'avatar', label: '修改头像' },
          ] as const).map(item => (
            <button
              key={item.key}
              onClick={() => { setTab(item.key); setInfoError(''); setPwdError(''); setAvatarError(''); setInfoSuccess(''); setPwdSuccess(''); setAvatarSuccess('') }}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === item.key
                  ? 'border-primary-500 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="p-6">
          {/* 修改姓名 */}
          {tab === 'info' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">账户名</label>
                <input
                  type="text"
                  value={session?.user?.email || ''}
                  disabled
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">姓名</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-primary-400 focus:border-primary-400"
                  placeholder="请输入姓名"
                />
              </div>
              {infoError && <p className="text-sm text-danger-600">{infoError}</p>}
              {infoSuccess && <p className="text-sm text-emerald-600">{infoSuccess}</p>}
              <button
                onClick={handleSaveInfo}
                disabled={infoLoading || !name.trim()}
                className="w-full px-4 py-2.5 bg-primary-500 text-white text-sm font-medium rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {infoLoading ? '保存中...' : '保存'}
              </button>
            </div>
          )}

          {/* 修改密码 */}
          {tab === 'password' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">当前密码</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-primary-400 focus:border-primary-400"
                  placeholder="请输入当前密码"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-primary-400 focus:border-primary-400"
                  placeholder="至少 6 位"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">确认新密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-primary-400 focus:border-primary-400"
                  placeholder="请再次输入新密码"
                />
              </div>
              {pwdError && <p className="text-sm text-danger-600">{pwdError}</p>}
              {pwdSuccess && <p className="text-sm text-emerald-600">{pwdSuccess}</p>}
              <button
                onClick={handleChangePassword}
                disabled={pwdLoading || !currentPassword || !newPassword || !confirmPassword}
                className="w-full px-4 py-2.5 bg-primary-500 text-white text-sm font-medium rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pwdLoading ? '修改中...' : '修改密码'}
              </button>
            </div>
          )}

          {/* 修改头像 */}
          {tab === 'avatar' && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-4">
                {/* 当前/预览头像 */}
                <div className="w-24 h-24 rounded-full overflow-hidden bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-3xl">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="预览" className="w-full h-full object-cover" />
                  ) : currentAvatar ? (
                    <Image src={currentAvatar} alt="头像" width={96} height={96} className="w-full h-full object-cover" unoptimized />
                  ) : (
                    displayName.charAt(0).toUpperCase()
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                <div className="flex gap-3 flex-wrap justify-center">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors"
                  >
                    选择图片
                  </button>
                  {avatarFile && rawFile && (
                    <button
                      onClick={() => { setAvatarFile(null); setAvatarPreview(null); setShowCropper(true) }}
                      className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors"
                    >
                      重新裁剪
                    </button>
                  )}
                  <button
                    onClick={handleUploadAvatar}
                    disabled={avatarLoading || !avatarFile}
                    className="px-4 py-2 bg-primary-500 text-white text-sm font-medium rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {avatarLoading ? '上传中...' : '上传头像'}
                  </button>
                </div>
              </div>

              <p className="text-xs text-gray-400 text-center">
                支持 JPG/PNG/GIF/WebP 格式，文件大小不超过 5MB。选择图片后可裁剪为正方形头像。
              </p>

              {avatarError && <p className="text-sm text-danger-600 text-center">{avatarError}</p>}
              {avatarSuccess && <p className="text-sm text-emerald-600 text-center">{avatarSuccess}</p>}
            </div>
          )}
        </div>
      </div>
      {/* 头像裁剪弹窗 */}
      {showCropper && rawFile && (
        <AvatarCropper
          file={rawFile}
          onCropComplete={handleCropComplete}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  )
}
