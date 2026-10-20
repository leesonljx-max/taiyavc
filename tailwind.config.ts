/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // 主强调色：紫罗兰（马卡龙系里的“葡萄”色，浅底深字皆可读）
        primary: {
          50: '#F5F3FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          400: '#A78BFA',
          500: '#8B5CF6',
          600: '#7C3AED',
          700: '#6D28D9',
          800: '#5B21B6',
          900: '#4C1D95',
        },
        // 状态色：成功翠绿 / 警示琥珀 / 下跌玫红（浅色底 + 深色字）
        success: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        danger: {
          50: '#fff1f2',
          100: '#ffe4e6',
          200: '#fecdd3',
          300: '#fda4af',
          400: '#fb7185',
          500: '#f43f5e',
          600: '#e11d48',
          700: '#be123c',
          800: '#9f1239',
          900: '#881337',
        },
        // 马卡龙色板（侧边栏菜单、数字卡片专用）
        macaron: {
          pink: '#F9C9DA',
          rose: '#F6B0C6',
          peach: '#FBD5B5',
          butter: '#FBE7A8',
          mint: '#BEE7D6',
          sage: '#CFE7C8',
          blue: '#B6DCEF',
          sky: '#CBE7F7',
          lavender: '#D5D2F2',
          lilac: '#E3D6F5',
          navy: '#3B4664',
          cream: '#FDF6EC',
        },
        // 语义化 token（canvas 为卡片内浅色底，跟随换肤 CSS 变量；全屏画布用 .app-canvas 类）
        canvas: 'var(--app-canvas-tint, #E7EFF2)',
        surface: '#FFFFFF',
        ink: {
          DEFAULT: '#2F3A55',
          muted: '#6B7589',
          faint: '#9AA2B1',
        },
        hairline: '#E2EAEF',
        // Tailwind 内置亮色系由默认色板提供（深色反转已移除）
      },
      boxShadow: {
        // 冷色柔和弥散阴影
        soft: '0 2px 10px rgba(23, 42, 58, 0.06)',
        'soft-lg': '0 10px 30px rgba(23, 42, 58, 0.10)',
        'soft-xl': '0 20px 48px rgba(23, 42, 58, 0.14)',
        // 兼容旧类名 shadow-soft-green（现为紫色光晕）
        'soft-green': '0 10px 28px rgba(124, 58, 237, 0.22)',
        card: '0 4px 16px rgba(23, 42, 58, 0.08)',
        // 卡片 Hover：底部彩虹亮光
        glow: '0 4px 14px -2px rgba(249, 168, 212, 0.75), 0 8px 22px -6px rgba(129, 140, 248, 0.7), 0 12px 28px -8px rgba(94, 234, 212, 0.6), 0 16px 34px -10px rgba(253, 186, 116, 0.55)',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)',
        'gradient-sidebar': 'linear-gradient(180deg, #F8FBFC 0%, #F0F5F7 100%)',
        'gradient-card': 'linear-gradient(135deg, #FFFFFF 0%, #FDFFFE 100%)',
        // 斜线纹理（未激活数据柱 / 弱化背景）
        'hatch': 'repeating-linear-gradient(45deg, #E2EAEF 0 5px, #F2F6F8 5px 11px)',
        'hatch-primary': 'repeating-linear-gradient(45deg, #8B5CF6 0 5px, #A78BFA 5px 11px)',
        'hatch-light': 'repeating-linear-gradient(45deg, #F0F5F7 0 5px, #FFFFFF 5px 11px)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'grow-bar': {
          from: { transform: 'scaleY(0)' },
          to: { transform: 'scaleY(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out',
        'grow-bar': 'grow-bar 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
}
