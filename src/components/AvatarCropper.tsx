'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface AvatarCropperProps {
  file: File | null
  onCropComplete: (croppedFile: File) => void
  onCancel: () => void
}

/**
 * 头像裁剪组件
 * - 正方形 1:1 裁剪
 * - 支持拖动调整位置
 * - 支持滑块缩放
 * - 输出裁剪后的 File 对象
 */
export default function AvatarCropper({ file, onCropComplete, onCancel }: AvatarCropperProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 })
  const [cropping, setCropping] = useState(false)

  // 容器大小（正方形）
  const CONTAINER_SIZE = 256

  useEffect(() => {
    if (!file) {
      setImageSrc(null)
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const src = e.target?.result as string
      setImageSrc(src)
      // 加载图片获取原始尺寸
      const img = new Image()
      img.onload = () => {
        setImageSize({ width: img.width, height: img.height })
        // 初始化：图片居中，缩放使图片填满容器
        const initialScale = Math.max(CONTAINER_SIZE / img.width, CONTAINER_SIZE / img.height)
        setScale(initialScale)
        setPosition({ x: 0, y: 0 })
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  }, [file])

  // 处理鼠标按下开始拖动
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    }
  }

  // 处理触摸开始
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return
    setIsDragging(true)
    dragStart.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      posX: position.x,
      posY: position.y,
    }
  }

  // 处理拖动
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    const deltaX = e.clientX - dragStart.current.x
    const deltaY = e.clientY - dragStart.current.y
    setPosition({
      x: dragStart.current.posX + deltaX,
      y: dragStart.current.posY + deltaY,
    })
  }, [isDragging])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return
    const deltaX = e.touches[0].clientX - dragStart.current.x
    const deltaY = e.touches[0].clientY - dragStart.current.y
    setPosition({
      x: dragStart.current.posX + deltaX,
      y: dragStart.current.posY + deltaY,
    })
  }, [isDragging])

  const stopDragging = useCallback(() => {
    setIsDragging(false)
  }, [])

  // 全局监听鼠标移动和释放
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', stopDragging)
      window.addEventListener('touchmove', handleTouchMove)
      window.addEventListener('touchend', stopDragging)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopDragging)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', stopDragging)
    }
  }, [isDragging, handleMouseMove, handleTouchMove, stopDragging])

  // 处理裁剪并输出 File
  const handleCrop = async () => {
    if (!imageSrc || !imageRef.current || !file) return
    setCropping(true)

    try {
      const canvas = document.createElement('canvas')
      canvas.width = CONTAINER_SIZE
      canvas.height = CONTAINER_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas context not available')

      // 加载原始图片
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('图片加载失败'))
        img.src = imageSrc
      })

      // 计算图片在容器中的显示位置和大小
      const displayWidth = imageSize.width * scale
      const displayHeight = imageSize.height * scale

      // 图片中心相对于容器的位置
      // position 是图片左上角相对于容器中心的偏移
      // 在 canvas 中，我们需要计算源图片的裁剪区域
      const containerCenter = CONTAINER_SIZE / 2

      // 图片左上角在容器坐标系中的位置
      const imgLeft = containerCenter + position.x - displayWidth / 2
      const imgTop = containerCenter + position.y - displayHeight / 2

      // 计算源图片中对应的裁剪区域
      // 容器(0,0)到(CONTAINER_SIZE, CONTAINER_SIZE)对应源图片的哪个区域
      const sourceX = -imgLeft / scale
      const sourceY = -imgTop / scale
      const sourceSize = CONTAINER_SIZE / scale

      // 绘制裁剪后的图片
      ctx.drawImage(
        img,
        sourceX, sourceY, sourceSize, sourceSize,  // 源区域
        0, 0, CONTAINER_SIZE, CONTAINER_SIZE       // 目标区域
      )

      // 转换为 Blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob)
            else reject(new Error('Canvas to Blob failed'))
          },
          'image/png',
          0.9
        )
      })

      // 转换为 File
      const croppedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.png'), {
        type: 'image/png',
      })

      onCropComplete(croppedFile)
    } catch (error) {
      console.error('Crop error:', error)
      alert('裁剪失败，请重试')
    } finally {
      setCropping(false)
    }
  }

  if (!imageSrc) return null

  const displayWidth = imageSize.width * scale
  const displayHeight = imageSize.height * scale
  const containerCenter = CONTAINER_SIZE / 2

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">裁剪头像</h3>

        {/* 裁剪区域 */}
        <div className="flex justify-center mb-4">
          <div
            ref={containerRef}
            className="relative overflow-hidden bg-gray-100 rounded-lg cursor-move"
            style={{ width: CONTAINER_SIZE, height: CONTAINER_SIZE }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
          >
            <img
              ref={imageRef}
              src={imageSrc}
              alt="裁剪预览"
              draggable={false}
              className="absolute select-none"
              style={{
                width: displayWidth,
                height: displayHeight,
                left: containerCenter + position.x - displayWidth / 2,
                top: containerCenter + position.y - displayHeight / 2,
                maxWidth: 'none',
                maxHeight: 'none',
              }}
            />
            {/* 裁剪框边框提示 */}
            <div className="absolute inset-0 pointer-events-none border-2 border-white/80 rounded-lg" />
          </div>
        </div>

        {/* 缩放滑块 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">缩放</label>
          <input
            type="range"
            min={Math.max(CONTAINER_SIZE / imageSize.width, CONTAINER_SIZE / imageSize.height)}
            max={Math.max(CONTAINER_SIZE / imageSize.width, CONTAINER_SIZE / imageSize.height) * 3}
            step={0.01}
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <p className="text-xs text-gray-400 text-center mb-4">
          拖动图片调整位置，使用滑块缩放，裁剪框为正方形
        </p>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={cropping}
            className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleCrop}
            disabled={cropping}
            className="flex-1 px-4 py-2.5 bg-primary-500 text-white text-sm font-medium rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cropping ? '裁剪中...' : '确认裁剪'}
          </button>
        </div>
      </div>
    </div>
  )
}
